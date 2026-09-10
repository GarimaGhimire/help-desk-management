package messages

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	sqldb "github.com/fintara/helpdesk/internal/db"
	"github.com/fintara/helpdesk/pkg/db"
	"github.com/fintara/helpdesk/pkg/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgtype"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		// Non-browser clients (mobile apps, API clients) send no Origin header.
		if origin == "" || origin == "null" {
			return true
		}
		allowed := os.Getenv("CORS_ORIGINS")
		if allowed == "" {
			allowed = "http://localhost:3000,http://localhost:3001"
		}
		for _, a := range strings.Split(allowed, ",") {
			if strings.TrimSpace(a) == origin {
				return true
			}
		}
		return false
	},
}

type Client struct {
	hub     *Hub
	conn    *websocket.Conn
	send    chan []byte
	groupID string
	userID  string
	repos   *db.Repos
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(4096)
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			break
		}

		var incoming struct {
			Content string `json:"content"`
		}
		if err := json.Unmarshal(data, &incoming); err != nil || strings.TrimSpace(incoming.Content) == "" {
			c.conn.WriteJSON(map[string]string{"error": "invalid message format"})
			continue
		}

		saved, err := c.repos.Queries.CreateMessage(context.Background(), sqldb.CreateMessageParams{
			GroupID:    uuidFromString(c.groupID),
			SenderID:   uuidFromString(c.userID),
			ReceiverID: pgtype.UUID{},
			Content:    strings.TrimSpace(incoming.Content),
		})
		if err != nil {
			log.Printf("create message failed: %v", err)
			c.conn.WriteJSON(map[string]string{"error": "failed to send message"})
			continue
		}

		payload, _ := json.Marshal(map[string]interface{}{
			"id":        saved.ID,
			"groupId":   c.groupID,
			"senderId":  userIDString(saved.SenderID),
			"content":   saved.Content,
			"createdAt": saved.CreatedAt.Time.Format(time.RFC3339),
		})

		c.hub.broadcast <- &BroadcastMsg{groupID: c.groupID, data: payload}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

type BroadcastMsg struct {
	groupID string
	data    []byte
}

type Hub struct {
	clients    map[string]map[*Client]bool
	register   chan *Client
	unregister chan *Client
	broadcast  chan *BroadcastMsg
}

func newHub() *Hub {
	return &Hub{
		clients:    make(map[string]map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan *BroadcastMsg),
	}
}

func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			if h.clients[client.groupID] == nil {
				h.clients[client.groupID] = make(map[*Client]bool)
			}
			h.clients[client.groupID][client] = true

		case client := <-h.unregister:
			if clients, ok := h.clients[client.groupID]; ok {
				if _, present := clients[client]; present {
					delete(clients, client)
					close(client.send)
					if len(clients) == 0 {
						delete(h.clients, client.groupID)
					}
				}
			}

		case msg := <-h.broadcast:
			for client := range h.clients[msg.groupID] {
				select {
				case client.send <- msg.data:
				default:
					delete(h.clients[msg.groupID], client)
					close(client.send)
				}
			}
		}
	}
}

func uuidFromString(s string) pgtype.UUID {
	var u pgtype.UUID
	u.Scan(s)
	return u
}

func userIDString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	b := u.Bytes
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

var (
	messageHub    = newHub()
	messageHubOnce sync.Once
)

func Handlers(repos *db.Repos) chi.Router {
	r := chi.NewRouter()
	r.Get("/ws", handleWebSocket(repos))
	r.Get("/search", searchMessages(repos))
	r.Get("/{groupId}", listMessages(repos))
	return r
}

func handleWebSocket(repos *db.Repos) http.HandlerFunc {
	messageHubOnce.Do(func() { go messageHub.run() })

	return func(w http.ResponseWriter, r *http.Request) {
		userID := middleware.GetUserID(r)
		if userID == "" {
			middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
			return
		}

		groupID := r.URL.Query().Get("groupId")
		if groupID == "" {
			middleware.RespondError(w, http.StatusBadRequest, "groupId is required")
			return
		}

		_, err := repos.Queries.GetGroupMember(r.Context(), sqldb.GetGroupMemberParams{
			GroupID: uuidFromString(groupID),
			UserID:  uuidFromString(userID),
		})
		if err != nil {
			middleware.RespondError(w, http.StatusForbidden, "not a member of this group")
			return
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("websocket upgrade failed: %v", err)
			return
		}

		client := &Client{
			hub:     messageHub,
			conn:    conn,
			send:    make(chan []byte, 256),
			groupID: groupID,
			userID:  userID,
			repos:   repos,
		}
		messageHub.register <- client

		go client.writePump()
		go client.readPump()
	}
}

func listMessages(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		groupID := chi.URLParam(r, "groupId")

		limit := 50
		if l := r.URL.Query().Get("limit"); l != "" {
			if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 200 {
				limit = parsed
			}
		}

		var before pgtype.Timestamptz
		if b := r.URL.Query().Get("before"); b != "" {
			before.Scan(b)
		}

		rows, err := repos.Queries.ListGroupMessages(r.Context(), sqldb.ListGroupMessagesParams{
			GroupID: uuidFromString(groupID),
			Column2: before,
			Limit:   int32(limit),
		})
		if err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to load messages")
			return
		}

		out := make([]map[string]interface{}, 0, len(rows))
		for i := len(rows) - 1; i >= 0; i-- {
			m := rows[i]
			out = append(out, map[string]interface{}{
				"id":        m.ID,
				"groupId":   m.GroupID,
				"senderId":  userIDString(m.SenderID),
				"content":   m.Content,
				"createdAt": m.CreatedAt.Time.Format(time.RFC3339),
			})
		}

		middleware.RespondJSON(w, http.StatusOK, out)
	}
}

func searchMessages(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		groupID := r.URL.Query().Get("groupId")
		query := strings.TrimSpace(r.URL.Query().Get("q"))
		if groupID == "" || query == "" {
			middleware.RespondError(w, http.StatusBadRequest, "groupId and q are required")
			return
		}

		rows, err := repos.Queries.SearchMessagesInGroup(r.Context(), sqldb.SearchMessagesInGroupParams{
			GroupID:        uuidFromString(groupID),
			PlaintoTsquery: query,
			Limit:          50,
		})
		if err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "search failed")
			return
		}

		out := make([]map[string]interface{}, 0, len(rows))
		for _, m := range rows {
			out = append(out, map[string]interface{}{
				"id":        m.ID,
				"groupId":   m.GroupID,
				"senderId":  userIDString(m.SenderID),
				"content":   m.Content,
				"createdAt": m.CreatedAt.Time.Format(time.RFC3339),
			})
		}

		middleware.RespondJSON(w, http.StatusOK, out)
	}
}
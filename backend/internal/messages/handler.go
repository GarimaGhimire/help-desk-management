package messages

import (
	"context"
	cryptoRand "crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	sqldb "github.com/fintara/helpdesk/internal/db"
	"github.com/fintara/helpdesk/pkg/access"
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
			c.sendJSON(map[string]string{"error": "invalid message format"})
			continue
		}

		// Server-enforced anti-spam: style the blocked client like Discord so
		// the cooldown is visible to the offending account only.
		if ok, retryAfter := messageLimiter.Allow(c.userID, incoming.Content, time.Now()); !ok {
			c.sendJSON(map[string]interface{}{
				"error":       "slow_down",
				"retry_after": retryAfter,
			})
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
			c.sendJSON(map[string]string{"error": "failed to send message"})
			continue
		}

		sender := c.senderInfo()
		payload, _ := json.Marshal(map[string]interface{}{
			"id":           saved.ID,
			"groupId":      c.groupID,
			"senderId":     userIDString(saved.SenderID),
			"content":      saved.Content,
			"createdAt":    saved.CreatedAt.Time.Format(time.RFC3339),
			"senderName":   sender.name,
			"senderAvatar": sender.avatar,
			"senderRole":   sender.role,
		})

		c.hub.broadcast <- &BroadcastMsg{groupID: c.groupID, data: payload}
	}
}

// senderInfo snapshots the sender's current display identity so live messages
// match what /messages/{id} returns.
func (c *Client) senderInfo() (sender struct{ name, avatar, role string }) {
	row, err := c.repos.Queries.GetUserByID(context.Background(), uuidFromString(c.userID))
	if err != nil {
		sender.name = "Staff"
		return
	}
	sender.name = row.Name
	if row.DisplayName.Valid && row.DisplayName.String != "" {
		sender.name = row.DisplayName.String
	}
	if row.AvatarUrl.Valid {
		sender.avatar = row.AvatarUrl.String
	}
	sender.role = string(row.Role)
	return
}

func senderAvatarString(t pgtype.Text) string {
	if t.Valid {
		return t.String
	}
	return ""
}

// sendJSON queues an outbound message through writePump, which is the only
// goroutine allowed to write to the connection. The hub may close the send
// channel while readPump is mid-send, so the send is panic-protected.
func (c *Client) sendJSON(v interface{}) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	defer func() { _ = recover() }()
	select {
	case c.send <- data:
	default:
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
	messageHub     = newHub()
	messageHubOnce sync.Once
	messageLimiter = newRateLimiter()
)

const maxAttachmentBytes = 15 << 20 // 15 MiB limit per file

func AttachmentHandler() http.Handler {
	uploadDir := os.Getenv("UPLOAD_DIR")
	if uploadDir == "" {
		uploadDir = "./data/uploads"
	}
	return http.StripPrefix("/attachments/", http.FileServer(http.Dir(filepath.Join(uploadDir, "attachments"))))
}

func Handlers(repos *db.Repos) chi.Router {
	r := chi.NewRouter()
	r.Post("/upload", uploadAttachment(repos))
	r.Get("/ws", handleWebSocket(repos))
	r.Get("/search", searchMessages(repos))
	r.Get("/{groupId}", listMessages(repos))
	return r
}

func uploadAttachment(repos *db.Repos) http.HandlerFunc {
	uploadDir := os.Getenv("UPLOAD_DIR")
	if uploadDir == "" {
		uploadDir = "./data/uploads"
	}
	attachmentDir := filepath.Join(uploadDir, "attachments")

	return func(w http.ResponseWriter, r *http.Request) {
		me := middleware.GetUser(r)
		if me == nil {
			middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
			return
		}

		if err := r.ParseMultipartForm(maxAttachmentBytes); err != nil {
			middleware.RespondError(w, http.StatusBadRequest, "file attachment must be under 15MB")
			return
		}

		file, header, err := r.FormFile("file")
		if err != nil {
			middleware.RespondError(w, http.StatusBadRequest, "file is required")
			return
		}
		defer file.Close()

		if header.Size > maxAttachmentBytes {
			middleware.RespondError(w, http.StatusBadRequest, "file size exceeds maximum limit of 15MB")
			return
		}

		data, err := io.ReadAll(io.LimitReader(file, maxAttachmentBytes))
		if err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to read uploaded file")
			return
		}
		if len(data) == 0 {
			middleware.RespondError(w, http.StatusBadRequest, "uploaded file is empty")
			return
		}

		if err := os.MkdirAll(attachmentDir, 0o755); err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to prepare storage")
			return
		}

		ext := filepath.Ext(header.Filename)
		cleanExt := strings.ToLower(strings.TrimSpace(ext))
		if cleanExt == "" {
			cleanExt = ".bin"
		}

		randomStr, _ := randomSuffix(6)
		filename := fmt.Sprintf("%d-%s%s", time.Now().UnixNano(), randomStr, cleanExt)
		dst := filepath.Join(attachmentDir, filename)

		if err := os.WriteFile(dst, data, 0o600); err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to save attachment")
			return
		}

		fileURL := "/attachments/" + filename
		isImage := strings.HasPrefix(http.DetectContentType(data), "image/")

		middleware.RespondJSON(w, http.StatusCreated, map[string]interface{}{
			"url":      fileURL,
			"name":     header.Filename,
			"size":     header.Size,
			"is_image": isImage,
		})
	}
}

func randomSuffix(n int) (string, error) {
	b := make([]byte, n)
	if _, err := io.ReadFull(cryptoRandReader, b); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", b), nil
}

var cryptoRandReader = cryptoRand.Reader

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

		me := middleware.GetUser(r)
		groupAccess, _ := access.GroupPermissions(r.Context(), repos, me, groupID)
		if !groupAccess {
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

		me := middleware.GetUser(r)
		groupAccess, _ := access.GroupPermissions(r.Context(), repos, me, groupID)
		if !groupAccess {
			middleware.RespondError(w, http.StatusNotFound, "group not found")
			return
		}

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
				"id":           m.ID,
				"groupId":      m.GroupID,
				"senderId":     userIDString(m.SenderID),
				"content":      m.Content,
				"createdAt":    m.CreatedAt.Time.Format(time.RFC3339),
				"senderName":   m.SenderName,
				"senderAvatar": senderAvatarString(m.SenderAvatar),
				"senderRole":   m.SenderRole,
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

		me := middleware.GetUser(r)
		groupAccess, _ := access.GroupPermissions(r.Context(), repos, me, groupID)
		if !groupAccess {
			middleware.RespondError(w, http.StatusNotFound, "group not found")
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
				"id":           m.ID,
				"groupId":      m.GroupID,
				"senderId":     userIDString(m.SenderID),
				"content":      m.Content,
				"createdAt":    m.CreatedAt.Time.Format(time.RFC3339),
				"senderName":   m.SenderName,
				"senderAvatar": senderAvatarString(m.SenderAvatar),
				"senderRole":   m.SenderRole,
			})
		}

		middleware.RespondJSON(w, http.StatusOK, out)
	}
}

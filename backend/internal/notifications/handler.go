package notifications

import (
	"encoding/json"
	"net/http"

	sqldb "github.com/fintara/helpdesk/internal/db"
	"github.com/fintara/helpdesk/pkg/db"
	"github.com/fintara/helpdesk/pkg/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Handler struct {
	repos *db.Repos
}

func NewHandler(repos *db.Repos) *Handler {
	return &Handler{repos: repos}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Use(middleware.Auth(h.repos))

	r.Get("/unreads", h.GetUnreads)
	r.Get("/mentions", h.GetMentions)
	r.Post("/read", h.MarkRead)

	return r
}

func (h *Handler) GetUnreads(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userIDStr := middleware.GetUserID(r)
	if userIDStr == "" {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	userID := uuidFromString(userIDStr)

	rows, err := h.repos.Queries.ListUserNotificationsByType(ctx, sqldb.ListUserNotificationsByTypeParams{
		UserID:  userID,
		Column2: []string{"unread"},
		Limit:   50,
	})
	if err != nil {
		http.Error(w, `{"error":"failed to fetch unread notifications"}`, http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, rows)
}

func (h *Handler) GetMentions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userIDStr := middleware.GetUserID(r)
	if userIDStr == "" {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	userID := uuidFromString(userIDStr)

	rows, err := h.repos.Queries.ListUserNotificationsByType(ctx, sqldb.ListUserNotificationsByTypeParams{
		UserID:  userID,
		Column2: []string{"mention", "reply"},
		Limit:   50,
	})
	if err != nil {
		http.Error(w, `{"error":"failed to fetch mention notifications"}`, http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, rows)
}

type MarkReadReq struct {
	NotificationIDs []string `json:"notificationIds"`
	GroupID         string   `json:"groupId"`
}

func (h *Handler) MarkRead(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userIDStr := middleware.GetUserID(r)
	if userIDStr == "" {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	userID := uuidFromString(userIDStr)

	var req MarkReadReq
	_ = json.NewDecoder(r.Body).Decode(&req)

	if req.GroupID != "" {
		_ = h.repos.Queries.MarkGroupNotificationsAsRead(ctx, sqldb.MarkGroupNotificationsAsReadParams{
			UserID:  userID,
			GroupID: uuidFromString(req.GroupID),
		})
	} else if len(req.NotificationIDs) > 0 {
		var uuids []pgtype.UUID
		for _, id := range req.NotificationIDs {
			uuids = append(uuids, uuidFromString(id))
		}
		_ = h.repos.Queries.MarkNotificationsAsRead(ctx, sqldb.MarkNotificationsAsReadParams{
			UserID:  userID,
			Column2: uuids,
		})
	} else {
		// Mark all as read
		_ = h.repos.Queries.MarkNotificationsAsRead(ctx, sqldb.MarkNotificationsAsReadParams{
			UserID:  userID,
			Column2: nil,
		})
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func uuidFromString(s string) pgtype.UUID {
	var u pgtype.UUID
	if s != "" {
		_ = u.Scan(s)
	}
	return u
}

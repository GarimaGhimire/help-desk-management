package documents

import (
	"encoding/json"
	"net/http"

	"github.com/fintara/helpdesk/pkg/db"
	"github.com/fintara/helpdesk/pkg/middleware"
	"github.com/go-chi/chi/v5"
)

func Handlers(repos *db.Repos) chi.Router {
	r := chi.NewRouter()
	r.Post("/upload", uploadDocument(repos))
	r.Get("/", listDocuments(repos))
	r.Route("/{id}", func(r chi.Router) {
		r.Get("/", getDocument(repos))
		r.Patch("/visibility", updateVisibility(repos))
		r.Post("/unlock", unlockDocument(repos))
	})
	return r
}

func uploadDocument(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(32 << 20); err != nil {
			middleware.RespondError(w, http.StatusBadRequest, "invalid upload")
			return
		}
		_ = repos
		middleware.RespondMessage(w, http.StatusCreated, "document uploaded")
	}
}

func listDocuments(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_ = repos
		middleware.RespondJSON(w, http.StatusOK, []interface{}{})
	}
}

func getDocument(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_ = repos
		middleware.RespondJSON(w, http.StatusOK, map[string]interface{}{})
	}
}

func updateVisibility(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Visibility string `json:"visibility"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			middleware.RespondError(w, http.StatusBadRequest, "visibility is required")
			return
		}
		_ = repos
		middleware.RespondMessage(w, http.StatusOK, "visibility updated")
	}
}

func unlockDocument(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Password == "" {
			middleware.RespondError(w, http.StatusBadRequest, "password is required")
			return
		}
		_ = repos
		middleware.RespondMessage(w, http.StatusOK, "document unlocked")
	}
}
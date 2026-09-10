package users

import (
	"encoding/json"
	"net/http"

	"github.com/fintara/helpdesk/pkg/db"
	"github.com/fintara/helpdesk/pkg/middleware"
	"github.com/go-chi/chi/v5"
)

func Handlers(repos *db.Repos) chi.Router {
	r := chi.NewRouter()
	r.Get("/search", searchUsers(repos))
	r.Get("/{id}", getUser(repos))
	return r
}

func searchUsers(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query().Get("q")
		if q == "" {
			middleware.RespondJSON(w, http.StatusOK, []interface{}{})
			return
		}
		_ = repos // TODO: repos.Queries.SearchUsers(ctx, q, 20)
		middleware.RespondJSON(w, http.StatusOK, []interface{}{})
	}
}

func getUser(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		_ = repos // TODO: repos.Queries.GetUserByID(ctx, id)
		middleware.RespondJSON(w, http.StatusOK, map[string]interface{}{
			"id":   id,
			"name": nil,
		})
	}
}

func decodeJSON(r *http.Request, v interface{}) error {
	return json.NewDecoder(r.Body).Decode(v)
}
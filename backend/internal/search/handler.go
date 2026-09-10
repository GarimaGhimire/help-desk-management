package search

import (
	"net/http"

	"github.com/fintara/helpdesk/pkg/db"
	"github.com/fintara/helpdesk/pkg/middleware"
	"github.com/go-chi/chi/v5"
)

func Handlers(repos *db.Repos) chi.Router {
	r := chi.NewRouter()
	r.Get("/", globalSearch(repos))
	return r
}

func globalSearch(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query().Get("q")
		if q == "" {
			middleware.RespondJSON(w, http.StatusOK, map[string]interface{}{
				"query":     q,
				"users":     []interface{}{},
				"groups":    []interface{}{},
				"messages":  []interface{}{},
				"documents": []interface{}{},
			})
			return
		}
		_ = repos // TODO: parallel search across all tables
		middleware.RespondJSON(w, http.StatusOK, map[string]interface{}{
			"query":     q,
			"users":     []interface{}{},
			"groups":    []interface{}{},
			"messages":  []interface{}{},
			"documents": []interface{}{},
		})
	}
}
package roles

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/fintara/helpdesk/pkg/db"
	"github.com/fintara/helpdesk/pkg/middleware"
	"github.com/go-chi/chi/v5"
)

type Service struct {
	repos *db.Repos
}

type CustomRole struct {
	ID          string `json:"id"`
	OrgID       string `json:"org_id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatedAt   string `json:"created_at"`
}

type Position struct {
	ID          string `json:"id"`
	OrgID       string `json:"org_id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatedAt   string `json:"created_at"`
}

func Handlers(repos *db.Repos) chi.Router {
	s := &Service{repos: repos}
	r := chi.NewRouter()

	r.Get("/custom-roles", s.listCustomRoles)
	r.Get("/positions", s.listPositions)

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequireRole("org_admin", "staff_admin", "superadmin"))
		r.Post("/custom-roles", s.createCustomRole)
		r.Post("/positions", s.createPosition)
	})

	return r
}

func (s *Service) listCustomRoles(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	orgID := me.OrgID
	rows, err := s.repos.Pool.Query(r.Context(),
		"SELECT id, org_id, name, coalesce(description, ''), created_at FROM custom_roles WHERE org_id = $1 OR $2 = 'superadmin' ORDER BY name ASC",
		db.ParseUUID(orgID), me.Role)
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to list roles")
		return
	}
	defer rows.Close()

	var list []CustomRole
	for rows.Next() {
		var cr CustomRole
		var id, oID string
		var created time.Time
		if err := rows.Scan(&id, &oID, &cr.Name, &cr.Description, &created); err == nil {
			cr.ID = id
			cr.OrgID = oID
			cr.CreatedAt = created.Format(time.RFC3339)
			list = append(list, cr)
		}
	}
	if list == nil {
		list = []CustomRole{}
	}
	middleware.RespondJSON(w, http.StatusOK, list)
}

func (s *Service) createCustomRole(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		middleware.RespondError(w, http.StatusBadRequest, "role name is required")
		return
	}

	name := strings.TrimSpace(req.Name)
	desc := strings.TrimSpace(req.Description)

	var cr CustomRole
	var id string
	var created time.Time
	err := s.repos.Pool.QueryRow(r.Context(),
		"INSERT INTO custom_roles (org_id, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING id, created_at",
		db.ParseUUID(me.OrgID), name, desc, db.ParseUUID(me.ID)).Scan(&id, &created)
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to create role")
		return
	}

	cr.ID = id
	cr.OrgID = me.OrgID
	cr.Name = name
	cr.Description = desc
	cr.CreatedAt = created.Format(time.RFC3339)
	middleware.RespondJSON(w, http.StatusCreated, cr)
}

func (s *Service) listPositions(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	orgID := me.OrgID
	rows, err := s.repos.Pool.Query(r.Context(),
		"SELECT id, org_id, name, coalesce(description, ''), created_at FROM positions WHERE org_id = $1 OR $2 = 'superadmin' ORDER BY name ASC",
		db.ParseUUID(orgID), me.Role)
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to list positions")
		return
	}
	defer rows.Close()

	var list []Position
	for rows.Next() {
		var p Position
		var id, oID string
		var created time.Time
		if err := rows.Scan(&id, &oID, &p.Name, &p.Description, &created); err == nil {
			p.ID = id
			p.OrgID = oID
			p.CreatedAt = created.Format(time.RFC3339)
			list = append(list, p)
		}
	}
	if list == nil {
		list = []Position{}
	}
	middleware.RespondJSON(w, http.StatusOK, list)
}

func (s *Service) createPosition(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		middleware.RespondError(w, http.StatusBadRequest, "position name is required")
		return
	}

	name := strings.TrimSpace(req.Name)
	desc := strings.TrimSpace(req.Description)

	var pos Position
	var id string
	var created time.Time
	err := s.repos.Pool.QueryRow(r.Context(),
		"INSERT INTO positions (org_id, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING id, created_at",
		db.ParseUUID(me.OrgID), name, desc, db.ParseUUID(me.ID)).Scan(&id, &created)
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to create position")
		return
	}

	pos.ID = id
	pos.OrgID = me.OrgID
	pos.Name = name
	pos.Description = desc
	pos.CreatedAt = created.Format(time.RFC3339)
	middleware.RespondJSON(w, http.StatusCreated, pos)
}

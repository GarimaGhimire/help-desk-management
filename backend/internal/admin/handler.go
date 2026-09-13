package admin

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	sqldb "github.com/fintara/helpdesk/internal/db"
	"github.com/fintara/helpdesk/pkg/audit"
	"github.com/fintara/helpdesk/pkg/db"
	"github.com/fintara/helpdesk/pkg/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Service struct {
	repos *db.Repos
}

func Handlers(repos *db.Repos) chi.Router {
	s := &Service{repos: repos}

	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequireRole("superadmin"))
		r.Post("/orgs", s.createOrg)
		r.Get("/orgs", s.listOrgs)
		r.Patch("/orgs/{id}", s.updateOrg)
		r.Delete("/orgs/{id}", s.deleteOrg)
	})

	// Audit logs: superadmins see everything (optionally per-org); org admins
	// are scoped to their own org.
	r.Get("/audit", s.listAudit)
	return r
}

// ------------------------------ organizations ------------------------------

func (s *Service) createOrg(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var req struct {
		Name        string `json:"name"`
		Slug        string `json:"slug"`
		StaffLimit  *int32 `json:"staff_limit"`
		GroupLimit  *int32 `json:"group_limit"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.RespondError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		middleware.RespondError(w, http.StatusBadRequest, "name is required")
		return
	}
	slug := slugify(req.Slug)
	if slug == "" {
		slug = slugify(req.Name)
	}
	if slug == "" {
		middleware.RespondError(w, http.StatusBadRequest, "could not derive a slug from the organization name")
		return
	}
	if validateLimit(req.StaffLimit) || validateLimit(req.GroupLimit) {
		middleware.RespondError(w, http.StatusBadRequest, "limits must be positive integers or null for unlimited")
		return
	}

	if _, err := s.repos.Queries.GetOrganizationBySlug(r.Context(), slug); err == nil {
		middleware.RespondError(w, http.StatusConflict, "slug already in use")
		return
	}

	org, err := s.repos.Queries.CreateOrganization(r.Context(), sqldb.CreateOrganizationParams{
		Name:      req.Name,
		Slug:      slug,
		StaffLimit: int4OrNull(req.StaffLimit),
		GroupLimit: int4OrNull(req.GroupLimit),
		CreatedBy: db.ParseUUID(me.ID),
	})
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to create organization")
		return
	}

	audit.Log(r, s.repos, "org.create", "organization", org.ID, map[string]interface{}{
		"name": org.Name,
		"slug": org.Slug,
	})
	middleware.RespondJSON(w, http.StatusCreated, serializeOrg(org))
}

func (s *Service) listOrgs(w http.ResponseWriter, r *http.Request) {
	orgs, err := s.repos.Queries.ListOrganizations(r.Context())
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to list organizations")
		return
	}
	out := make([]orgResponse, 0, len(orgs))
	for _, o := range orgs {
		out = append(out, serializeOrg(o))
	}
	middleware.RespondJSON(w, http.StatusOK, out)
}

func (s *Service) updateOrg(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var req struct {
		IsActive   *bool  `json:"is_active"`
		StaffLimit *int32 `json:"staff_limit"`
		GroupLimit *int32 `json:"group_limit"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.RespondError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if validateLimit(req.StaffLimit) || validateLimit(req.GroupLimit) {
		middleware.RespondError(w, http.StatusBadRequest, "limits must be positive integers or null for unlimited")
		return
	}

	id := chi.URLParam(r, "id")
	org, err := s.repos.Queries.GetOrganization(r.Context(), db.ParseUUID(id))
	if err != nil {
		middleware.RespondError(w, http.StatusNotFound, "organization not found")
		return
	}

	isActive := org.IsActive
	if req.IsActive != nil {
		isActive = *req.IsActive
	}
	staffLimit := org.StaffLimit
	if req.StaffLimit != nil {
		staffLimit = int4OrNull(req.StaffLimit)
	}
	groupLimit := org.GroupLimit
	if req.GroupLimit != nil {
		groupLimit = int4OrNull(req.GroupLimit)
	}

	updated, err := s.repos.Queries.UpdateOrganization(r.Context(), sqldb.UpdateOrganizationParams{
		ID:         org.ID,
		IsActive:   isActive,
		StaffLimit: staffLimit,
		GroupLimit: groupLimit,
	})
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to update organization")
		return
	}

	if isActive != org.IsActive {
		action := "org.suspend"
		if isActive {
			action = "org.activate"
		}
		audit.Log(r, s.repos, action, "organization", org.ID, map[string]interface{}{
			"is_active": isActive,
		})
	}
	audit.Log(r, s.repos, "org.update", "organization", org.ID, map[string]interface{}{
		"staff_limit": int4Value(staffLimit),
		"group_limit": int4Value(groupLimit),
	})

	middleware.RespondJSON(w, http.StatusOK, serializeOrg(updated))
}

// ------------------------------ org deletion ------------------------------

// deleteOrg removes an organization and everything it owns: staff accounts,
// groups, memberships, messages, documents and audit rows. The whole network
// of rows is removed inside a single transaction so a failure leaves the org
// untouched. The org.delete audit event is recorded with org_id NULL (the
// actor is a superadmin without an org) and survives the purge.
func (s *Service) deleteOrg(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	id := chi.URLParam(r, "id")
	orgID := db.ParseUUID(id)

	org, err := s.repos.Queries.GetOrganization(r.Context(), orgID)
	if err != nil {
		middleware.RespondError(w, http.StatusNotFound, "organization not found")
		return
	}

	ctx := r.Context()
	tx, err := s.repos.Pool.Begin(ctx)
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to start deletion")
		return
	}
	defer tx.Rollback(ctx)

	// Maximum FK fan-out of a tenant; children (and orphans pointing at org
	// users) are removed before the users and the org row itself.
	cleanup := []string{
		`DELETE FROM documents
		   WHERE group_id IN (SELECT id FROM groups WHERE org_id = $1)
		      OR uploaded_by IN (SELECT id FROM users WHERE org_id = $1)`,
		`DELETE FROM messages
		   WHERE group_id IN (SELECT id FROM groups WHERE org_id = $1)
		      OR sender_id IN (SELECT id FROM users WHERE org_id = $1)
		      OR receiver_id IN (SELECT id FROM users WHERE org_id = $1)`,
		`DELETE FROM groups WHERE org_id = $1`,
		`DELETE FROM audit_logs
		   WHERE org_id = $1
		      OR actor_id IN (SELECT id FROM users WHERE org_id = $1)`,
		`DELETE FROM users WHERE org_id = $1`,
		`DELETE FROM organizations WHERE id = $1`,
	}

	for _, stmt := range cleanup {
		if _, err := tx.Exec(ctx, stmt, orgID); err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to delete organization")
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to delete organization")
		return
	}

	audit.Log(r, s.repos, "org.delete", "organization", orgID, map[string]interface{}{
		"name":        org.Name,
		"slug":        org.Slug,
		"staff_limit": int4Value(org.StaffLimit),
		"group_limit": int4Value(org.GroupLimit),
	})
	middleware.RespondJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// ------------------------------ audit logs ------------------------------

func (s *Service) listAudit(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	limit := 100
	if l := r.URL.Query().Get("limit"); l != "" {
		var parsed int
		if _, err := fmt.Sscanf(l, "%d", &parsed); err == nil && parsed > 0 && parsed <= 200 {
			limit = parsed
		}
	}

	var orgScope pgtype.UUID
	if me.Role == "superadmin" {
		if orgID := r.URL.Query().Get("org_id"); orgID != "" {
			orgScope = db.ParseUUID(orgID)
		}
	} else {
		orgScope = db.ParseUUID(me.OrgID)
	}

	rows, err := s.repos.Queries.ListAuditLogs(r.Context(), sqldb.ListAuditLogsParams{
		Column1: orgScope,
		Limit:   int32(limit),
	})
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to list audit logs")
		return
	}

	out := make([]auditEntry, 0, len(rows))
	for _, a := range rows {
		out = append(out, serializeAudit(a))
	}
	middleware.RespondJSON(w, http.StatusOK, out)
}

// ------------------------------ helpers ------------------------------

var nonSlugChars = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = nonSlugChars.ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}

// validateLimit reports whether a limit value is invalid (negative or zero).
func validateLimit(v *int32) bool {
	return v != nil && *v <= 0
}

// int4OrNull converts an optional int32 into a pgtype.Int4.
func int4OrNull(v *int32) pgtype.Int4 {
	if v == nil {
		return pgtype.Int4{}
	}
	return pgtype.Int4{Int32: *v, Valid: true}
}

func int4Value(v pgtype.Int4) interface{} {
	if !v.Valid {
		return nil
	}
	return v.Int32
}

type orgResponse struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Slug       string  `json:"slug"`
	IsActive   bool    `json:"is_active"`
	StaffLimit *int32  `json:"staff_limit"`
	GroupLimit *int32  `json:"group_limit"`
	CreatedBy  *string `json:"created_by"`
	CreatedAt  string  `json:"created_at"`
}

func serializeOrg(o sqldb.Organization) orgResponse {
	resp := orgResponse{
		ID:        db.UUIDString(o.ID),
		Name:      o.Name,
		Slug:      o.Slug,
		IsActive:  o.IsActive,
		CreatedAt: o.CreatedAt.Time.UTC().Format(time.RFC3339),
	}
	if o.StaffLimit.Valid {
		v := o.StaffLimit.Int32
		resp.StaffLimit = &v
	}
	if o.GroupLimit.Valid {
		v := o.GroupLimit.Int32
		resp.GroupLimit = &v
	}
	if o.CreatedBy.Valid {
		c := db.UUIDString(o.CreatedBy)
		resp.CreatedBy = &c
	}
	return resp
}

type auditEntry struct {
	ID         string                 `json:"id"`
	OrgID      *string                `json:"org_id"`
	ActorID    *string                `json:"actor_id"`
	Action     string                 `json:"action"`
	TargetType *string                `json:"target_type"`
	TargetID   *string                `json:"target_id"`
	Metadata   map[string]interface{} `json:"metadata,omitempty"`
	IPAddress  *string                `json:"ip_address"`
	CreatedAt  string                 `json:"created_at"`
}

func serializeAudit(a sqldb.AuditLog) auditEntry {
	resp := auditEntry{
		ID:          db.UUIDString(a.ID),
		Action:      a.Action,
		CreatedAt:   a.CreatedAt.Time.UTC().Format(time.RFC3339),
		Metadata:    map[string]interface{}{},
	}
	if a.OrgID.Valid {
		v := db.UUIDString(a.OrgID)
		resp.OrgID = &v
	}
	if a.ActorID.Valid {
		v := db.UUIDString(a.ActorID)
		resp.ActorID = &v
	}
	if a.TargetType.Valid {
		v := a.TargetType.String
		resp.TargetType = &v
	}
	if a.TargetID.Valid {
		v := db.UUIDString(a.TargetID)
		resp.TargetID = &v
	}
	if a.IpAddress.Valid {
		v := a.IpAddress.String
		resp.IPAddress = &v
	}
	if len(a.Metadata) > 0 {
		json.Unmarshal(a.Metadata, &resp.Metadata)
	}
	return resp
}
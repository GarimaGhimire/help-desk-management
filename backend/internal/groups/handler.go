package groups

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	sqldb "github.com/fintara/helpdesk/internal/db"
	"github.com/fintara/helpdesk/pkg/access"
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
	r.Get("/", s.listGroups)
	r.Get("/search", s.searchGroups)

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequireRole("org_admin", "superadmin"))
		r.Post("/", s.createGroup)
	})

	r.Route("/{id}", func(r chi.Router) {
		r.Get("/", s.getGroup)
		r.Get("/members", s.listMembers)

		// Group admin / org admin / superadmin management actions.
		r.Group(func(r chi.Router) {
			r.Use(s.requireManage)
			r.Post("/members", s.addMember)
			r.Patch("/members/{userId}/role", s.updateMemberRole)
			r.Delete("/members/{userId}", s.removeMember)
		})
	})
	return r
}

// ------------------------------ middleware ------------------------------

// requireManage enforces the manage permission (group admin, org admin or
// superadmin) for member management routes.
func (s *Service) requireManage(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		me := middleware.GetUser(r)
		if me == nil {
			middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		_, manage := access.GroupPermissions(r.Context(), s.repos, me, chi.URLParam(r, "id"))
		if !manage {
			middleware.RespondError(w, http.StatusForbidden, "insufficient permissions")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ------------------------------ reads ------------------------------

func (s *Service) listGroups(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	if me.Role == "org_member" {
		rows, err := s.repos.Queries.ListGroupsForUser(r.Context(), db.ParseUUID(me.ID))
		if err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to list groups")
			return
		}
		out := make([]groupResponse, 0, len(rows))
		for _, g := range rows {
			out = append(out, serializeGroup(g.ID, g.OrgID, g.Name, g.Type, g.CreatedBy, g.CreatedAt, &g.RoleInGroup))
		}
		middleware.RespondJSON(w, http.StatusOK, out)
		return
	}

	rows, err := s.repos.Queries.ListGroupsByOrg(r.Context(), orgScope(me))
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to list groups")
		return
	}
	out := make([]groupResponse, 0, len(rows))
	for _, g := range rows {
		out = append(out, serializeGroup(g.ID, g.OrgID, g.Name, g.Type, g.CreatedBy, g.CreatedAt, nil))
	}
	middleware.RespondJSON(w, http.StatusOK, out)
}

func (s *Service) searchGroups(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		middleware.RespondJSON(w, http.StatusOK, []groupResponse{})
		return
	}

	rows, err := s.repos.Queries.SearchGroupsByOrg(r.Context(), sqldb.SearchGroupsByOrgParams{
		Column1:        orgScope(me),
		Column2:        userScope(me),
		PlaintoTsquery: q,
		Limit:          50,
	})
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "search failed")
		return
	}
	out := make([]groupResponse, 0, len(rows))
	for _, g := range rows {
		out = append(out, serializeGroup(g.ID, g.OrgID, g.Name, g.Type, g.CreatedBy, g.CreatedAt, nil))
	}
	middleware.RespondJSON(w, http.StatusOK, out)
}

func (s *Service) getGroup(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	accessGroup, _ := access.GroupPermissions(r.Context(), s.repos, me, chi.URLParam(r, "id"))
	if !accessGroup {
		middleware.RespondError(w, http.StatusNotFound, "group not found")
		return
	}

	g, err := s.repos.Queries.GetGroupByID(r.Context(), db.ParseUUID(chi.URLParam(r, "id")))
	if err != nil {
		middleware.RespondError(w, http.StatusNotFound, "group not found")
		return
	}
	middleware.RespondJSON(w, http.StatusOK, serializeGroup(g.ID, g.OrgID, g.Name, g.Type, g.CreatedBy, g.CreatedAt, nil))
}

func (s *Service) listMembers(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	accessGroup, _ := access.GroupPermissions(r.Context(), s.repos, me, chi.URLParam(r, "id"))
	if !accessGroup {
		middleware.RespondError(w, http.StatusNotFound, "group not found")
		return
	}

	rows, err := s.repos.Queries.ListGroupMembers(r.Context(), db.ParseUUID(chi.URLParam(r, "id")))
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to list members")
		return
	}

	out := make([]memberResponse, 0, len(rows))
	for _, m := range rows {
		out = append(out, serializeMember(m))
	}
	middleware.RespondJSON(w, http.StatusOK, out)
}

// ------------------------------ writes ------------------------------

func (s *Service) createGroup(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var req struct {
		Name  string `json:"name"`
		Type  string `json:"type"`
		OrgID string `json:"org_id"`
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

	groupType := sqldb.GroupTypeInternal
	switch strings.TrimSpace(req.Type) {
	case "", "internal":
	case "bank":
		groupType = sqldb.GroupTypeBank
	default:
		middleware.RespondError(w, http.StatusBadRequest, "type must be internal or bank")
		return
	}

	var orgID pgtype.UUID
	switch me.Role {
	case "superadmin":
		orgID = db.ParseUUID(req.OrgID)
		if !orgID.Valid {
			middleware.RespondError(w, http.StatusBadRequest, "org_id is required for platform admins")
			return
		}
	default: // org_admin
		orgID = db.ParseUUID(me.OrgID)
	}

	// The org must exist and permit creating another group.
	org, err := s.repos.Queries.GetOrganization(r.Context(), orgID)
	if err != nil {
		middleware.RespondError(w, http.StatusNotFound, "organization not found")
		return
	}
	if org.GroupLimit.Valid {
		count, err := s.repos.Queries.CountGroupsByOrg(r.Context(), orgID)
		if err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to check group limit")
			return
		}
		if count >= int64(org.GroupLimit.Int32) {
			middleware.RespondError(w, http.StatusForbidden, "this organization has reached its group limit")
			return
		}
	}

	group, err := s.repos.Queries.CreateGroup(r.Context(), sqldb.CreateGroupParams{
		Name:      req.Name,
		Type:      groupType,
		CreatedBy: db.ParseUUID(me.ID),
		OrgID:     orgID,
	})
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to create group")
		return
	}

	if _, err := s.repos.Queries.AddGroupMember(r.Context(), sqldb.AddGroupMemberParams{
		GroupID:     group.ID,
		UserID:      db.ParseUUID(me.ID),
		RoleInGroup: sqldb.GroupMemberRoleAdmin,
	}); err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to create group")
		return
	}

	audit.Log(r, s.repos, "group.create", "group", group.ID, map[string]interface{}{
		"name": group.Name,
	})
	middleware.RespondJSON(w, http.StatusCreated, serializeGroup(group.ID, group.OrgID, group.Name, group.Type, group.CreatedBy, group.CreatedAt, nil))
}

func (s *Service) addMember(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	groupID := chi.URLParam(r, "id")

	var req struct {
		UserID string `json:"user_id"`
		Role   string `json:"role_in_group"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.UserID) == "" {
		middleware.RespondError(w, http.StatusBadRequest, "user_id is required")
		return
	}

	role, ok := parseMemberRole(req.Role)
	if !ok {
		middleware.RespondError(w, http.StatusBadRequest, "role_in_group must be member or admin")
		return
	}

	// The target member must belong to the same org as the group.
	g, err := s.repos.Queries.GetGroupByID(r.Context(), db.ParseUUID(groupID))
	if err != nil {
		middleware.RespondError(w, http.StatusNotFound, "group not found")
		return
	}
	target, err := s.repos.Queries.GetUserByID(r.Context(), db.ParseUUID(req.UserID))
	if err != nil {
		middleware.RespondError(w, http.StatusNotFound, "user not found")
		return
	}
	if g.OrgID.Valid {
		if !target.OrgID.Valid || db.UUIDString(target.OrgID) != db.UUIDString(g.OrgID) {
			middleware.RespondError(w, http.StatusForbidden, "user does not belong to this organization")
			return
		}
	}

	member, err := s.repos.Queries.AddGroupMember(r.Context(), sqldb.AddGroupMemberParams{
		GroupID:     g.ID,
		UserID:      target.ID,
		RoleInGroup: role,
	})
	if err != nil {
		middleware.RespondError(w, http.StatusConflict, "member already in group")
		return
	}

	audit.Log(r, s.repos, "group.member_add", "group", g.ID, map[string]interface{}{
		"user_id": db.UUIDString(target.ID),
	})
	middleware.RespondJSON(w, http.StatusCreated, serializeMemberRow(member.ID, member.GroupID, member.UserID, member.RoleInGroup, member.JoinedAt))
}

func (s *Service) updateMemberRole(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	groupID := chi.URLParam(r, "id")
	userID := chi.URLParam(r, "userId")

	var req struct {
		Role string `json:"role_in_group"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.RespondError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	role, ok := parseMemberRole(req.Role)
	if !ok {
		middleware.RespondError(w, http.StatusBadRequest, "role_in_group must be member or admin")
		return
	}

	g, err := s.repos.Queries.GetGroupByID(r.Context(), db.ParseUUID(groupID))
	if err != nil {
		middleware.RespondError(w, http.StatusNotFound, "group not found")
		return
	}
	target, err := s.repos.Queries.GetUserByID(r.Context(), db.ParseUUID(userID))
	if err != nil || !s.isMember(r, g.ID, target.ID) {
		middleware.RespondError(w, http.StatusNotFound, "member not found")
		return
	}

	member, err := s.repos.Queries.UpdateMemberRole(r.Context(), sqldb.UpdateMemberRoleParams{
		GroupID:     g.ID,
		UserID:      target.ID,
		RoleInGroup: role,
	})
	if err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to update role")
		return
	}

	audit.Log(r, s.repos, "group.member_role", "group", g.ID, map[string]interface{}{
		"user_id": db.UUIDString(target.ID),
		"role":    string(role),
	})
	middleware.RespondJSON(w, http.StatusOK, serializeMemberRow(member.ID, member.GroupID, member.UserID, member.RoleInGroup, member.JoinedAt))
}

func (s *Service) removeMember(w http.ResponseWriter, r *http.Request) {
	me := middleware.GetUser(r)
	if me == nil {
		middleware.RespondError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	groupID := chi.URLParam(r, "id")
	userID := chi.URLParam(r, "userId")

	g, err := s.repos.Queries.GetGroupByID(r.Context(), db.ParseUUID(groupID))
	if err != nil {
		middleware.RespondError(w, http.StatusNotFound, "group not found")
		return
	}
	row, err := s.repos.Queries.GetGroupMember(r.Context(), sqldb.GetGroupMemberParams{
		GroupID: g.ID,
		UserID:  db.ParseUUID(userID),
	})
	if err != nil {
		middleware.RespondError(w, http.StatusNotFound, "member not found")
		return
	}

	// Prevent a group losing its last admin.
	if row.RoleInGroup == sqldb.GroupMemberRoleAdmin {
		members, err := s.repos.Queries.ListGroupMembers(r.Context(), g.ID)
		if err == nil {
			admins := 0
			for _, m := range members {
				if m.RoleInGroup == sqldb.GroupMemberRoleAdmin && db.UUIDString(m.UserID) != userID {
					admins++
				}
			}
			if admins == 0 {
				middleware.RespondError(w, http.StatusBadRequest, "cannot remove the last group admin")
				return
			}
		}
	}

	if err := s.repos.Queries.RemoveGroupMember(r.Context(), sqldb.RemoveGroupMemberParams{
		GroupID: g.ID,
		UserID:  row.UserID,
	}); err != nil {
		middleware.RespondError(w, http.StatusInternalServerError, "failed to remove member")
		return
	}

	audit.Log(r, s.repos, "group.member_remove", "group", g.ID, map[string]interface{}{
		"user_id": db.UUIDString(row.UserID),
	})
	middleware.RespondMessage(w, http.StatusOK, "member removed")
}

// ------------------------------ helpers ------------------------------

func (s *Service) isMember(r *http.Request, groupID, userID pgtype.UUID) bool {
	_, err := s.repos.Queries.GetGroupMember(r.Context(), sqldb.GetGroupMemberParams{
		GroupID: groupID,
		UserID:  userID,
	})
	return err == nil
}

// orgScope returns a null UUID for superadmins (meaning "any org" in queries).
func orgScope(me *middleware.AuthUser) pgtype.UUID {
	if me.Role == "superadmin" {
		return pgtype.UUID{}
	}
	return db.ParseUUID(me.OrgID)
}

// userScope restricts search to groups the user belongs to. Admins pass null
// (meaning "any group in scope") because they manage all org groups.
func userScope(me *middleware.AuthUser) pgtype.UUID {
	if me.Role == "org_member" {
		return db.ParseUUID(me.ID)
	}
	return pgtype.UUID{}
}

func parseMemberRole(s string) (sqldb.GroupMemberRole, bool) {
	switch strings.TrimSpace(s) {
	case "", "member":
		return sqldb.GroupMemberRoleMember, true
	case "admin":
		return sqldb.GroupMemberRoleAdmin, true
	}
	return "", false
}

type groupResponse struct {
	ID        string  `json:"id"`
	OrgID     *string `json:"org_id"`
	Name      string  `json:"name"`
	Type      string  `json:"type"`
	CreatedBy string  `json:"created_by"`
	CreatedAt string  `json:"created_at"`
	Role      *string `json:"role_in_group,omitempty"`
}

func serializeGroup(id, orgID pgtype.UUID, name string, groupType sqldb.GroupType, createdBy pgtype.UUID, createdAt pgtype.Timestamptz, role *sqldb.GroupMemberRole) groupResponse {
	resp := groupResponse{
		ID:        db.UUIDString(id),
		Name:      name,
		Type:      string(groupType),
		CreatedBy: db.UUIDString(createdBy),
		CreatedAt: createdAt.Time.UTC().Format(time.RFC3339),
	}
	if orgID.Valid {
		o := db.UUIDString(orgID)
		resp.OrgID = &o
	}
	if role != nil {
		ro := string(*role)
		resp.Role = &ro
	}
	return resp
}

type memberResponse struct {
	ID          string  `json:"id"`
	GroupID     string  `json:"group_id"`
	UserID      string  `json:"user_id"`
	RoleInGroup string  `json:"role_in_group"`
	JoinedAt    string  `json:"joined_at"`
	UserName    string  `json:"user_name"`
	Email       *string `json:"email"`
	Phone       *string `json:"phone"`
}

func serializeMember(m sqldb.ListGroupMembersRow) memberResponse {
	resp := memberResponse{
		ID:          db.UUIDString(m.ID),
		GroupID:     db.UUIDString(m.GroupID),
		UserID:      db.UUIDString(m.UserID),
		RoleInGroup: string(m.RoleInGroup),
		JoinedAt:    m.JoinedAt.Time.UTC().Format(time.RFC3339),
		UserName:    m.UserName,
	}
	if m.Email.Valid {
		e := m.Email.String
		resp.Email = &e
	}
	if m.Phone.Valid {
		p := m.Phone.String
		resp.Phone = &p
	}
	return resp
}

func serializeMemberRow(id, groupID, userID pgtype.UUID, role sqldb.GroupMemberRole, joinedAt pgtype.Timestamptz) memberResponse {
	resp := memberResponse{
		ID:          db.UUIDString(id),
		GroupID:     db.UUIDString(groupID),
		UserID:      db.UUIDString(userID),
		RoleInGroup: string(role),
		JoinedAt:    joinedAt.Time.UTC().Format(time.RFC3339),
	}
	return resp
}
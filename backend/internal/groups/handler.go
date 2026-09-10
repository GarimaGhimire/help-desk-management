package groups

import (
	"encoding/json"
	"net/http"

	sqldb "github.com/fintara/helpdesk/internal/db"
	"github.com/fintara/helpdesk/pkg/db"
	"github.com/fintara/helpdesk/pkg/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func Handlers(repos *db.Repos) chi.Router {
	r := chi.NewRouter()
	r.Post("/", createGroup(repos))
	r.Get("/", listGroups(repos))
	r.Route("/{id}", func(r chi.Router) {
		r.Get("/", getGroup(repos))
		r.Post("/members", addMember(repos))
		r.Patch("/members/{userId}/role", updateMemberRole(repos))
		r.Get("/members", listMembers(repos))
	})
	return r
}

func parseUUID(s string) pgtype.UUID {
	var u pgtype.UUID
	u.Scan(s)
	return u
}

func createGroup(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := middleware.GetUserID(r)

		var req struct {
			Name string `json:"name"`
			Type string `json:"type"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
			middleware.RespondError(w, http.StatusBadRequest, "name is required")
			return
		}

		groupType := sqldb.GroupTypeInternal
		if req.Type == "bank" {
			groupType = sqldb.GroupTypeBank
		}

		group, err := repos.Queries.CreateGroup(r.Context(), sqldb.CreateGroupParams{
			Name:      req.Name,
			Type:      groupType,
			CreatedBy: parseUUID(userID),
		})
		if err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to create group")
			return
		}

		repos.Queries.AddGroupMember(r.Context(), sqldb.AddGroupMemberParams{
			GroupID:     group.ID,
			UserID:      parseUUID(userID),
			RoleInGroup: sqldb.GroupMemberRoleAdmin,
		})

		middleware.RespondJSON(w, http.StatusCreated, group)
	}
}

func listGroups(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := middleware.GetUserID(r)

		groups, err := repos.Queries.ListGroupsForUser(r.Context(), parseUUID(userID))
		if err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to list groups")
			return
		}

		if groups == nil {
			groups = []sqldb.ListGroupsForUserRow{}
		}
		middleware.RespondJSON(w, http.StatusOK, groups)
	}
}

func getGroup(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")

		group, err := repos.Queries.GetGroup(r.Context(), parseUUID(id))
		if err != nil {
			middleware.RespondError(w, http.StatusNotFound, "group not found")
			return
		}

		middleware.RespondJSON(w, http.StatusOK, group)
	}
}

func addMember(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		groupID := chi.URLParam(r, "id")

		var req struct {
			UserID string `json:"user_id"`
			Role   string `json:"role_in_group"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.UserID == "" {
			middleware.RespondError(w, http.StatusBadRequest, "user_id is required")
			return
		}

		role := sqldb.GroupMemberRoleMember
		if req.Role == "admin" {
			role = sqldb.GroupMemberRoleAdmin
		}

		member, err := repos.Queries.AddGroupMember(r.Context(), sqldb.AddGroupMemberParams{
			GroupID:     parseUUID(groupID),
			UserID:      parseUUID(req.UserID),
			RoleInGroup: role,
		})
		if err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to add member")
			return
		}

		middleware.RespondJSON(w, http.StatusCreated, member)
	}
}

func updateMemberRole(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		groupID := chi.URLParam(r, "id")
		userID := chi.URLParam(r, "userId")

		var req struct {
			Role string `json:"role_in_group"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Role == "" {
			middleware.RespondError(w, http.StatusBadRequest, "role_in_group is required")
			return
		}

		role := sqldb.GroupMemberRoleMember
		if req.Role == "admin" {
			role = sqldb.GroupMemberRoleAdmin
		}

		member, err := repos.Queries.UpdateMemberRole(r.Context(), sqldb.UpdateMemberRoleParams{
			GroupID:     parseUUID(groupID),
			UserID:      parseUUID(userID),
			RoleInGroup: role,
		})
		if err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to update role")
			return
		}

		middleware.RespondJSON(w, http.StatusOK, member)
	}
}

func listMembers(repos *db.Repos) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		groupID := chi.URLParam(r, "id")

		members, err := repos.Queries.ListGroupMembers(r.Context(), parseUUID(groupID))
		if err != nil {
			middleware.RespondError(w, http.StatusInternalServerError, "failed to list members")
			return
		}

		if members == nil {
			members = []sqldb.ListGroupMembersRow{}
		}
		middleware.RespondJSON(w, http.StatusOK, members)
	}
}

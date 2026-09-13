package access

import (
	"context"

	sqldb "github.com/fintara/helpdesk/internal/db"
	"github.com/fintara/helpdesk/pkg/db"
	"github.com/fintara/helpdesk/pkg/middleware"
)

// GroupPermissions resolves what the user may do within a group.
//  - access: may read the group, its members and messages
//  - manage: may add/remove members and change their group roles
// Superadmins (no org) can access and manage every group.
func GroupPermissions(ctx context.Context, repos *db.Repos, user *middleware.AuthUser, groupID string) (access, manage bool) {
	g, err := repos.Queries.GetGroupByID(ctx, db.ParseUUID(groupID))
	if err != nil {
		return false, false
	}

	// Superadmins stand outside any org and oversee everything.
	if user.Role == "superadmin" {
		return true, true
	}

	// The group must belong to the caller's org.
	if !g.OrgID.Valid || user.OrgID == "" {
		return false, false
	}
	if db.UUIDString(g.OrgID) != user.OrgID {
		return false, false
	}

	// Org admins can see and manage every group in their org.
	if user.Role == "org_admin" {
		return true, true
	}

	m, err := repos.Queries.GetGroupMember(ctx, sqldb.GetGroupMemberParams{
		GroupID: db.ParseUUID(groupID),
		UserID:  db.ParseUUID(user.ID),
	})
	if err != nil {
		return false, false
	}

	return true, m.RoleInGroup == sqldb.GroupMemberRoleAdmin
}
-- name: CreateGroup :one
INSERT INTO groups (name, type, created_by)
VALUES ($1, $2, $3)
RETURNING id, name, type, created_by, created_at;

-- name: GetGroup :one
SELECT g.id, g.name, g.type, g.created_by, g.created_at
FROM groups g
WHERE g.id = $1 LIMIT 1;

-- name: ListGroupsForUser :many
SELECT g.id, g.name, g.type, g.created_by, g.created_at,
       gm.role_in_group
FROM groups g
JOIN group_members gm ON gm.group_id = g.id
WHERE gm.user_id = $1
ORDER BY g.created_at DESC;

-- name: AddGroupMember :one
INSERT INTO group_members (group_id, user_id, role_in_group)
VALUES ($1, $2, $3)
RETURNING id, group_id, user_id, role_in_group, joined_at;

-- name: GetGroupMember :one
SELECT id, group_id, user_id, role_in_group, joined_at
FROM group_members
WHERE group_id = $1 AND user_id = $2 LIMIT 1;

-- name: ListGroupMembers :many
SELECT gm.id, gm.group_id, gm.user_id, gm.role_in_group, gm.joined_at,
       u.name AS user_name, u.email, u.phone
FROM group_members gm
JOIN users u ON u.id = gm.user_id
WHERE gm.group_id = $1
ORDER BY gm.joined_at;

-- name: UpdateMemberRole :one
UPDATE group_members
SET role_in_group = $3
WHERE group_id = $1 AND user_id = $2
RETURNING id, group_id, user_id, role_in_group, joined_at;

-- name: RemoveGroupMember :exec
DELETE FROM group_members WHERE group_id = $1 AND user_id = $2;
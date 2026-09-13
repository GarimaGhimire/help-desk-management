-- name: CreateOrganization :one
INSERT INTO organizations (name, slug, staff_limit, group_limit, created_by)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, name, slug, is_active, staff_limit, group_limit, created_by, created_at;

-- name: GetOrganization :one
SELECT id, name, slug, is_active, staff_limit, group_limit, created_by, created_at
FROM organizations
WHERE id = $1
LIMIT 1;

-- name: GetOrganizationBySlug :one
SELECT id, name, slug, is_active, staff_limit, group_limit, created_by, created_at
FROM organizations
WHERE slug = $1
LIMIT 1;

-- name: ListOrganizations :many
SELECT id, name, slug, is_active, staff_limit, group_limit, created_by, created_at
FROM organizations
ORDER BY created_at DESC;

-- name: SetOrganizationActive :exec
UPDATE organizations SET is_active = $2 WHERE id = $1;

-- name: UpdateOrganizationLimits :exec
UPDATE organizations
SET staff_limit = $2, group_limit = $3
WHERE id = $1;

-- name: UpdateOrganization :one
UPDATE organizations
SET is_active = $2, staff_limit = $3, group_limit = $4
WHERE id = $1
RETURNING id, name, slug, is_active, staff_limit, group_limit, created_by, created_at;
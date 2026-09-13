-- name: ListUsersByOrg :many
SELECT id, org_id, name, display_name, email, phone, avatar_url, role, language_pref, is_active, invited_by, must_change_password, last_login_at, created_at
FROM users
WHERE ($1::uuid IS NULL OR org_id = $1)
ORDER BY created_at DESC
LIMIT $2;

-- name: SearchUsersByOrg :many
SELECT id, org_id, name, display_name, email, phone, avatar_url, role, language_pref, is_active, invited_by, must_change_password, last_login_at, created_at
FROM users
WHERE ($1::uuid IS NULL OR org_id = $1)
  AND (
    name_search @@ plainto_tsquery('english', $2)
    OR name ILIKE '%' || $2 || '%'
    OR email ILIKE '%' || $2 || '%'
    OR phone ILIKE '%' || $2 || '%'
  )
ORDER BY created_at DESC
LIMIT $3;

-- name: GetUserByID :one
SELECT id, org_id, name, display_name, email, phone, avatar_url, role, language_pref, is_active, invited_by, must_change_password, last_login_at, created_at
FROM users
WHERE id = $1
LIMIT 1;

-- name: UpdateUser :one
UPDATE users
SET name = $3,
    email = $4,
    phone = $5,
    role = $6,
    language_pref = $7,
    is_active = $8
WHERE id = $1 AND ($2::uuid IS NULL OR org_id = $2)
RETURNING id, org_id, name, display_name, email, phone, avatar_url, role, language_pref, is_active, invited_by, must_change_password, last_login_at, created_at;

-- name: CountActiveOrgAdmins :one
SELECT COUNT(*) FROM users WHERE org_id = $1 AND role = 'org_admin' AND is_active = TRUE;

-- name: CountUsersByOrg :one
SELECT COUNT(*) FROM users WHERE org_id = $1;

-- name: UpdateUserProfile :one
UPDATE users SET display_name = $2
WHERE id = $1
RETURNING id, org_id, name, display_name, email, phone, avatar_url, role, language_pref, is_active, invited_by, must_change_password, last_login_at, created_at;

-- name: UpdateUserAvatar :one
UPDATE users SET avatar_url = $2
WHERE id = $1
RETURNING id, org_id, name, display_name, email, phone, avatar_url, role, language_pref, is_active, invited_by, must_change_password, last_login_at, created_at;

-- name: UpdateUserPhone :one
UPDATE users SET phone = $2
WHERE id = $1
RETURNING id, org_id, name, display_name, email, phone, avatar_url, role, language_pref, is_active, invited_by, must_change_password, last_login_at, created_at;

-- name: ClearUserAvatar :one
UPDATE users SET avatar_url = NULL
WHERE id = $1
RETURNING id, org_id, name, display_name, email, phone, avatar_url, role, language_pref, is_active, invited_by, must_change_password, last_login_at, created_at;

-- name: DeactivateUser :one
UPDATE users SET is_active = FALSE
WHERE id = $1
RETURNING id, org_id, name, display_name, email, phone, avatar_url, role, language_pref, is_active, invited_by, must_change_password, last_login_at, created_at;
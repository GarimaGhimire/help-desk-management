-- name: CreateUser :one
INSERT INTO users (name, email, phone, password_hash, role, language_pref)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, name, email, phone, role, language_pref, created_at;

-- name: GetUserByEmail :one
SELECT id, name, email, phone, role, language_pref, created_at
FROM users
WHERE email = $1 LIMIT 1;

-- name: GetUserByPhone :one
SELECT id, name, email, phone, role, language_pref, created_at
FROM users
WHERE phone = $1 LIMIT 1;

-- name: GetUserByID :one
SELECT id, name, email, phone, role, language_pref, created_at
FROM users
WHERE id = $1 LIMIT 1;

-- name: SearchUsers :many
SELECT id, name, email, phone, role, language_pref, created_at
FROM users
WHERE name_search @@ plainto_tsquery('english', $1)
   OR name ILIKE '%' || $1 || '%'
ORDER BY created_at DESC
LIMIT $2;

-- name: UpdateLanguagePref :exec
UPDATE users SET language_pref = $2 WHERE id = $1;

-- name: CreateOTP :one
INSERT INTO otp_codes (user_id, code, channel, expires_at)
VALUES ($1, $2, $3, NOW() + interval '5 minutes')
RETURNING id, user_id, code, channel, expires_at, verified_at, created_at;

-- name: GetLatestValidOTP :one
SELECT id, user_id, code, channel, expires_at, verified_at
FROM otp_codes
WHERE user_id = $1 AND channel = $2 AND verified_at IS NULL
ORDER BY created_at DESC
LIMIT 1;

-- name: MarkOTPVerified :exec
UPDATE otp_codes SET verified_at = NOW() WHERE id = $1 AND verified_at IS NULL;

-- name: CountRecentOTPRequests :one
SELECT COUNT(*) FROM otp_codes
WHERE user_id = $1 AND created_at > NOW() - interval '1 hour';
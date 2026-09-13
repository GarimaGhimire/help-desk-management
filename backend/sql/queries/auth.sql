-- name: CreateUser :one
INSERT INTO users (name, email, phone, password_hash, role, org_id, language_pref, invited_by, must_change_password)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING id, org_id, name, display_name, email, phone, password_hash, avatar_url, role, language_pref, is_active, invited_by, must_change_password, last_login_at, created_at;

-- name: GetUserAuthByContact :one
SELECT id, org_id, name, display_name, email, phone, password_hash, avatar_url, role, language_pref, is_active, invited_by, must_change_password, last_login_at, created_at
FROM users
WHERE email = $1 OR phone = $1
ORDER BY (email = $1) DESC
LIMIT 1;

-- name: GetUserAuthByEmail :one
SELECT id, org_id, name, display_name, email, phone, password_hash, avatar_url, role, language_pref, is_active, invited_by, must_change_password, last_login_at, created_at
FROM users
WHERE email = $1
LIMIT 1;

-- name: GetUserAuthByPhone :one
SELECT id, org_id, name, display_name, email, phone, password_hash, avatar_url, role, language_pref, is_active, invited_by, must_change_password, last_login_at, created_at
FROM users
WHERE phone = $1
LIMIT 1;

-- name: GetUserAuthByID :one
SELECT id, org_id, name, display_name, email, phone, password_hash, avatar_url, role, language_pref, is_active, invited_by, must_change_password, last_login_at, created_at
FROM users
WHERE id = $1
LIMIT 1;

-- name: IsEmailTaken :one
SELECT EXISTS (SELECT 1 FROM users WHERE email = $1);

-- name: IsPhoneTaken :one
SELECT EXISTS (SELECT 1 FROM users WHERE phone = $1);

-- name: UpdatePasswordHash :exec
UPDATE users SET password_hash = $2, must_change_password = FALSE WHERE id = $1;

-- name: UpdatePasswordRequireReset :exec
UPDATE users SET password_hash = $2, must_change_password = TRUE WHERE id = $1;

-- name: UpdateLastLogin :exec
UPDATE users SET last_login_at = NOW() WHERE id = $1;

-- name: UpdateLanguagePref :exec
UPDATE users SET language_pref = $2 WHERE id = $1;

-- name: CreateOTP :one
INSERT INTO otp_codes (user_id, code, channel, purpose, expires_at)
VALUES ($1, $2, $3, $4, NOW() + interval '5 minutes')
RETURNING id, user_id, code, channel, purpose, attempts, expires_at, verified_at, created_at;

-- name: GetLatestValidOTP :one
SELECT id, user_id, code, channel, purpose, attempts, expires_at, verified_at, created_at
FROM otp_codes
WHERE user_id = $1 AND channel = $2 AND purpose = $3 AND verified_at IS NULL AND expires_at > NOW()
ORDER BY created_at DESC
LIMIT 1;

-- name: IncrementOTPAttempts :exec
UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1;

-- name: MarkOTPVerified :exec
UPDATE otp_codes SET verified_at = NOW() WHERE id = $1 AND verified_at IS NULL;

-- name: CountRecentOTPRequests :one
SELECT COUNT(*) FROM otp_codes
WHERE user_id = $1 AND purpose = $2 AND created_at > NOW() - interval '1 hour';
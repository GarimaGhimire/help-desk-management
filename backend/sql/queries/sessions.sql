-- name: CreateSession :one
INSERT INTO sessions (user_id, token_hash, user_agent, ip_address, expires_at)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, user_id, token_hash, user_agent, ip_address, expires_at, revoked_at, created_at;

-- name: GetActiveSession :one
SELECT id, user_id, token_hash, user_agent, ip_address, expires_at, revoked_at, created_at
FROM sessions
WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()
LIMIT 1;

-- name: RevokeSession :exec
UPDATE sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL;

-- name: RevokeOtherSessions :exec
UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL AND id <> $2;

-- name: RevokeAllUserSessions :exec
UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL;
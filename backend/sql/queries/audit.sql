-- name: CreateAuditLog :one
INSERT INTO audit_logs (org_id, actor_id, action, target_type, target_id, metadata, ip_address)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, org_id, actor_id, action, target_type, target_id, metadata, ip_address, created_at;

-- name: ListAuditLogs :many
SELECT id, org_id, actor_id, action, target_type, target_id, metadata, ip_address, created_at
FROM audit_logs
WHERE ($1::uuid IS NULL OR org_id = $1)
ORDER BY created_at DESC
LIMIT $2;
-- name: CreateDocument :one
INSERT INTO documents (uploaded_by, group_id, filename, storage_path, visibility, password_hash, allowed_roles)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, uploaded_by, group_id, filename, storage_path, visibility, password_hash, allowed_roles, created_at;

-- name: GetDocument :one
SELECT id, uploaded_by, group_id, filename, storage_path, visibility, password_hash, allowed_roles, created_at
FROM documents
WHERE id = $1 LIMIT 1;

-- name: ListAllDocuments :many
SELECT d.id, d.uploaded_by, d.group_id, d.filename, d.storage_path,
       d.visibility, d.password_hash, d.allowed_roles, d.created_at,
       COALESCE(u.display_name, u.name) AS uploader_name
FROM documents d
JOIN users u ON u.id = d.uploaded_by
ORDER BY d.created_at DESC;

-- name: UpdateDocumentVisibility :one
UPDATE documents SET visibility = $2, allowed_roles = $3
WHERE id = $1
RETURNING id, uploaded_by, group_id, filename, storage_path, visibility, password_hash, allowed_roles, created_at;

-- name: SetDocumentPassword :exec
UPDATE documents SET password_hash = $2 WHERE id = $1;

-- name: GrantDocumentAccess :exec
INSERT INTO document_access (document_id, user_id)
VALUES ($1, $2)
ON CONFLICT (document_id, user_id) DO NOTHING;

-- name: RevokeDocumentAccess :exec
DELETE FROM document_access WHERE document_id = $1 AND user_id = $2;

-- name: ClearDocumentAccessList :exec
DELETE FROM document_access WHERE document_id = $1;

-- name: GetDocumentAccessList :many
SELECT da.user_id, COALESCE(u.display_name, u.name) AS user_name, u.email
FROM document_access da
JOIN users u ON u.id = da.user_id
WHERE da.document_id = $1;

-- name: DeleteDocument :exec
DELETE FROM documents WHERE id = $1;
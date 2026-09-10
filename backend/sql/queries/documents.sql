-- name: CreateDocument :one
INSERT INTO documents (uploaded_by, group_id, filename, storage_path, visibility, password_hash)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, uploaded_by, group_id, filename, storage_path, visibility, password_hash, created_at;

-- name: GetDocument :one
SELECT id, uploaded_by, group_id, filename, storage_path, visibility, password_hash, created_at
FROM documents
WHERE id = $1 LIMIT 1;

-- name: ListDocumentsForUser :many
SELECT DISTINCT d.id, d.uploaded_by, d.group_id, d.filename, d.storage_path,
                d.visibility, d.password_hash, d.created_at
FROM documents d
LEFT JOIN document_access da ON da.document_id = d.id
WHERE d.visibility = 'all'
   OR d.uploaded_by = $1
   OR da.user_id = $1
ORDER BY d.created_at DESC;

-- name: UpdateDocumentVisibility :one
UPDATE documents SET visibility = $2
WHERE id = $1
RETURNING id, uploaded_by, group_id, filename, storage_path, visibility, password_hash, created_at;

-- name: SetDocumentPassword :exec
UPDATE documents SET password_hash = $2 WHERE id = $1;

-- name: GrantDocumentAccess :exec
INSERT INTO document_access (document_id, user_id)
VALUES ($1, $2)
ON CONFLICT (document_id, user_id) DO NOTHING;

-- name: RevokeDocumentAccess :exec
DELETE FROM document_access WHERE document_id = $1 AND user_id = $2;

-- name: HasDocumentAccess :one
SELECT EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = $1
      AND (d.visibility = 'all' OR d.uploaded_by = $2)
    UNION
    SELECT 1 FROM document_access da
    WHERE da.document_id = $1 AND da.user_id = $2
) AS has_access;
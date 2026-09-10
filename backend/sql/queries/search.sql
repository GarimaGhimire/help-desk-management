-- name: GlobalSearchUsers :many
SELECT id, name, email, phone, role, language_pref, created_at
FROM users
WHERE name_search @@ plainto_tsquery('english', $1)
ORDER BY created_at DESC;

-- name: GlobalSearchMessages :many
SELECT id, group_id, sender_id, receiver_id, content, created_at, edited_at
FROM messages
WHERE content_search @@ plainto_tsquery('english', $1)
ORDER BY created_at DESC
LIMIT $2;

-- name: GlobalSearchDocuments :many
SELECT id, uploaded_by, group_id, filename, storage_path, visibility, created_at
FROM documents
WHERE filename_search @@ plainto_tsquery('english', $1)
ORDER BY created_at DESC
LIMIT $2;
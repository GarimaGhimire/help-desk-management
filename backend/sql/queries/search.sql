-- name: GlobalSearchUsers :many
SELECT id, org_id, name, email, phone, role, language_pref, is_active, last_login_at, created_at
FROM users
WHERE ($1::uuid IS NULL OR org_id = $1)
  AND name_search @@ plainto_tsquery('english', $2)
ORDER BY created_at DESC;

-- name: GlobalSearchMessages :many
SELECT m.id, m.group_id, m.sender_id, m.receiver_id, m.content, m.created_at, m.edited_at
FROM messages m
JOIN groups g ON g.id = m.group_id
WHERE ($1::uuid IS NULL OR g.org_id = $1)
  AND ($2::uuid IS NULL OR EXISTS (
        SELECT 1 FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = $2))
  AND m.content_search @@ plainto_tsquery('english', $3)
ORDER BY m.created_at DESC
LIMIT $4;

-- name: GlobalSearchDocuments :many
SELECT d.id, d.uploaded_by, d.group_id, d.filename, d.storage_path, d.visibility, d.created_at
FROM documents d
LEFT JOIN groups g ON g.id = d.group_id
WHERE ($1::uuid IS NULL OR g.org_id = $1)
  AND ($2::uuid IS NULL
       OR d.uploaded_by = $2
       OR EXISTS (
        SELECT 1 FROM group_members gm WHERE gm.group_id = d.group_id AND gm.user_id = $2))
  AND d.filename_search @@ plainto_tsquery('english', $3)
ORDER BY d.created_at DESC
LIMIT $4;
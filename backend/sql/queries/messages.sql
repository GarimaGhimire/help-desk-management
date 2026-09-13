-- name: CreateMessage :one
INSERT INTO messages (group_id, sender_id, receiver_id, content)
VALUES ($1, $2, $3, $4)
RETURNING id, group_id, sender_id, receiver_id, content, created_at, edited_at;

-- name: ListGroupMessages :many
SELECT m.id, m.group_id, m.sender_id, m.receiver_id, m.content, m.created_at, m.edited_at,
       COALESCE(u.display_name, u.name) AS sender_name,
       u.avatar_url AS sender_avatar,
       u.role AS sender_role
FROM messages m
JOIN users u ON u.id = m.sender_id
WHERE m.group_id = $1
  AND ($2::timestamptz IS NULL OR m.created_at < $2)
ORDER BY m.created_at DESC
LIMIT $3;

-- name: ListDirectMessages :many
SELECT id, group_id, sender_id, receiver_id, content, created_at, edited_at
FROM messages
WHERE group_id IS NULL
  AND ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))
ORDER BY created_at DESC
LIMIT $3;

-- name: UpdateMessage :one
UPDATE messages SET content = $2, edited_at = NOW()
WHERE id = $1
RETURNING id, group_id, sender_id, receiver_id, content, created_at, edited_at;

-- name: SearchMessagesInGroup :many
SELECT m.id, m.group_id, m.sender_id, m.receiver_id, m.content, m.created_at, m.edited_at,
       COALESCE(u.display_name, u.name) AS sender_name,
       u.avatar_url AS sender_avatar,
       u.role AS sender_role
FROM messages m
JOIN users u ON u.id = m.sender_id
WHERE m.group_id = $1
  AND m.content_search @@ plainto_tsquery('english', $2)
ORDER BY m.created_at DESC
LIMIT $3;
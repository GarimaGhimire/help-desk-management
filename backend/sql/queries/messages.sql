-- name: CreateMessage :one
INSERT INTO messages (group_id, sender_id, receiver_id, content, reply_to_id)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, group_id, sender_id, receiver_id, content, reply_to_id, created_at, edited_at;

-- name: GetMessageByID :one
SELECT id, group_id, sender_id, receiver_id, content, reply_to_id, created_at, edited_at
FROM messages WHERE id = $1 LIMIT 1;

-- name: ListGroupMessages :many
SELECT m.id, m.group_id, m.sender_id, m.receiver_id, m.content, m.reply_to_id, m.created_at, m.edited_at,
       COALESCE(u.display_name, u.name) AS sender_name,
       u.avatar_url AS sender_avatar,
       u.role AS sender_role,
       rm.content AS reply_content,
       COALESCE(ru.display_name, ru.name) AS reply_sender_name
FROM messages m
JOIN users u ON u.id = m.sender_id
LEFT JOIN messages rm ON rm.id = m.reply_to_id
LEFT JOIN users ru ON ru.id = rm.sender_id
WHERE m.group_id = $1
  AND ($2::timestamptz IS NULL OR m.created_at < $2)
ORDER BY m.created_at DESC
LIMIT $3;

-- name: ListDirectMessages :many
SELECT id, group_id, sender_id, receiver_id, content, reply_to_id, created_at, edited_at
FROM messages
WHERE group_id IS NULL
  AND ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))
ORDER BY created_at DESC
LIMIT $3;

-- name: UpdateMessage :one
UPDATE messages SET content = $2, edited_at = NOW()
WHERE id = $1
RETURNING id, group_id, sender_id, receiver_id, content, reply_to_id, created_at, edited_at;

-- name: DeleteMessage :exec
DELETE FROM messages WHERE id = $1;

-- name: SearchMessagesInGroup :many
SELECT m.id, m.group_id, m.sender_id, m.receiver_id, m.content, m.reply_to_id, m.created_at, m.edited_at,
       COALESCE(u.display_name, u.name) AS sender_name,
       u.avatar_url AS sender_avatar,
       u.role AS sender_role,
       rm.content AS reply_content,
       COALESCE(ru.display_name, ru.name) AS reply_sender_name
FROM messages m
JOIN users u ON u.id = m.sender_id
LEFT JOIN messages rm ON rm.id = m.reply_to_id
LEFT JOIN users ru ON ru.id = rm.sender_id
WHERE m.group_id = $1
  AND m.content_search @@ plainto_tsquery('english', $2)
ORDER BY m.created_at DESC
LIMIT $3;
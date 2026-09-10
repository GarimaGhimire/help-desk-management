-- name: CreateMessage :one
INSERT INTO messages (group_id, sender_id, receiver_id, content)
VALUES ($1, $2, $3, $4)
RETURNING id, group_id, sender_id, receiver_id, content, created_at, edited_at;

-- name: ListGroupMessages :many
SELECT id, group_id, sender_id, receiver_id, content, created_at, edited_at
FROM messages
WHERE group_id = $1
  AND ($2::timestamptz IS NULL OR created_at < $2)
ORDER BY created_at DESC
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
SELECT id, group_id, sender_id, receiver_id, content, created_at, edited_at
FROM messages
WHERE group_id = $1
  AND content_search @@ plainto_tsquery('english', $2)
ORDER BY created_at DESC
LIMIT $3;
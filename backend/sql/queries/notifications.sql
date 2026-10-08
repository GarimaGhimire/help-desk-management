-- name: CreateNotification :one
INSERT INTO notifications (user_id, actor_id, group_id, message_id, type)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, user_id, actor_id, group_id, message_id, type, is_read, created_at;

-- name: ListUserNotificationsByType :many
SELECT n.id, n.user_id, n.actor_id, n.group_id, n.message_id, n.type, n.is_read, n.created_at,
       COALESCE(u.display_name, u.name) AS actor_name,
       u.avatar_url AS actor_avatar,
       g.name AS group_name,
       m.content AS message_content
FROM notifications n
JOIN users u ON u.id = n.actor_id
JOIN groups g ON g.id = n.group_id
JOIN messages m ON m.id = n.message_id
WHERE n.user_id = $1 AND ($2::text[] IS NULL OR n.type = ANY($2::text[]))
ORDER BY n.created_at DESC
LIMIT $3 NULLIF $3, 0;

-- name: GetUnreadCount :one
SELECT COUNT(*)::bigint AS unread_count
FROM notifications
WHERE user_id = $1 AND is_read = false;

-- name: MarkNotificationsAsRead :exec
UPDATE notifications
SET is_read = true
WHERE user_id = $1 AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]));

-- name: MarkGroupNotificationsAsRead :exec
UPDATE notifications
SET is_read = true
WHERE user_id = $1 AND group_id = $2;

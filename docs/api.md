# API Reference (v1)

All endpoints except auth require `Authorization: Bearer <jwt>`.

## Auth
| Method | Endpoint          | Body                                        | Purpose                |
|--------|-------------------|---------------------------------------------|------------------------|
| POST   | `/auth/request-otp` | `{ "contact": "phone_or_email" }`         | Send OTP via SMS/Email |
| POST   | `/auth/verify-otp`  | `{ "contact": "...", "code": "123456" }` | Verify + issue JWT     |

## Users / Staff Directory
| Method | Endpoint             | Query     | Purpose                       |
|--------|----------------------|-----------|-------------------------------|
| GET    | `/users/search`      | `?q=term` | Full-text search employees    |
| GET    | `/users/{id}`        |           | User profile                  |

## Groups
| Method | Endpoint                                    | Body | Purpose                         |
|--------|---------------------------------------------|------|---------------------------------|
| POST   | `/groups`                                   | `{ "name", "type" }` | Create group      |
| POST   | `/groups/{id}/members`                      | `{ "user_id", "role_in_group" }` | Add member (admin) |
| PATCH  | `/groups/{id}/members/{userId}/role`        | `{ "role_in_group" }` | Promote/demote     |
| GET    | `/groups/{id}/members`                      |      | List members                    |
| GET    | `/groups/{id}/messages?before=<ts>&limit=`  |      | Paginated history               |

## Messages
| Method | Endpoint            | Query     | Purpose             |
|--------|---------------------|-----------|---------------------|
| GET    | `/ws?groupId={id}`  |           | Real-time chat      |
| GET    | `/messages/search`  | `?q=&groupId=`, `?q=&receiverId=` | Search chat |

## Documents
| Method | Endpoint                          | Purpose                                |
|--------|-----------------------------------|----------------------------------------|
| POST   | `/documents/upload`               | Multipart upload + metadata            |
| GET    | `/documents`                      | List visible docs                      |
| GET    | `/documents/{id}`                 | Download (visibility + password check) |
| PATCH  | `/documents/{id}/visibility`      | Set all/restricted + allowed users     |
| POST   | `/documents/{id}/unlock`          | `{ "password" }` → verify + issue grant |

## Global Search
| Method | Endpoint  | Query     | Purpose                               |
|--------|-----------|-----------|---------------------------------------|
| GET    | `/search` | `?q=term` | Aggregated users/groups/messages/docs |

## Error Format
```json
{ "error": "human readable message" }
```
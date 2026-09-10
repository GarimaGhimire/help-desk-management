```mermaid
erDiagram
    USERS {
        uuid id PK
        varchar name
        varchar email UK
        varchar phone UK
        varchar password_hash
        user_role role "employee|superadmin"
        varchar language_pref
        timestamptz created_at
        tsvector name_search
    }

    OTP_CODES {
        uuid id PK
        uuid user_id FK
        varchar code
        otp_channel channel "sms|email"
        timestamptz expires_at
        timestamptz verified_at
    }

    GROUPS {
        uuid id PK
        varchar name
        group_type type "internal|bank"
        uuid created_by FK
        timestamptz created_at
    }

    GROUP_MEMBERS {
        uuid id PK
        uuid group_id FK
        uuid user_id FK
        group_member_role role_in_group "admin|member"
        timestamptz joined_at
    }

    MESSAGES {
        uuid id PK
        uuid group_id FK, nullable
        uuid sender_id FK
        uuid receiver_id FK, nullable
        text content
        timestamptz created_at
        timestamptz edited_at
        tsvector content_search
    }

    DOCUMENTS {
        uuid id PK
        uuid uploaded_by FK
        uuid group_id FK
        varchar filename
        varchar storage_path
        doc_visibility visibility "all|restricted"
        varchar password_hash
        timestamptz created_at
        tsvector filename_search
    }

    DOCUMENT_ACCESS {
        uuid id PK
        uuid document_id FK
        uuid user_id FK
    }

    USERS ||--o{ OTP_CODES : "receives"
    USERS ||--o{ GROUP_MEMBERS : "belongs to"
    GROUPS ||--o{ GROUP_MEMBERS : "has"
    USERS ||--o{ MESSAGES : "sends"
    GROUPS ||--o{ MESSAGES : "contains"
    DOCUMENTS ||--o{ DOCUMENT_ACCESS : "grants"
    USERS ||--o{ DOCUMENTS : "uploads"
    USERS ||--o{ DOCUMENT_ACCESS : "has access to"
```

## Design Notes

### Key Decisions
- **role_in_group** (not global role): a user can be admin in one group, member in another.
- **Full-text search**: Generated `tsvector` columns on `users.name`, `messages.content`, `documents.filename` with GIN indexes.
- **Group is polymorphic**: banks are `groups` with `type='bank'`, banks table is not separate.
- **1:1 chat**: `messages.group_id = NULL` + `receiver_id` set.

### Hot Queries
- `group_members(group_id, user_id)` — unique composite, membership check
- `messages(group_id, created_at DESC)` — chat scroll-back pagination

### Access Rules
- Documents: `visibility='all'` → anyone in the group; `restricted` → rows in `document_access` + password check via `documents.password_hash`.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE TYPE user_role AS ENUM ('org_admin', 'org_member', 'superadmin');
CREATE TYPE group_type AS ENUM ('internal', 'bank');
CREATE TYPE group_member_role AS ENUM ('admin', 'member');
CREATE TYPE otp_channel AS ENUM ('sms', 'email');
CREATE TYPE otp_purpose AS ENUM ('login', 'password_reset');
CREATE TYPE doc_visibility AS ENUM ('all', 'restricted');

-- ------------------------------------------------------------------
-- Organizations (tenants)
-- ------------------------------------------------------------------
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(120) UNIQUE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    staff_limit INTEGER,
    group_limit INTEGER,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------
-- Users
-- ------------------------------------------------------------------
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID REFERENCES organizations(id),
    name VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(20) UNIQUE,
    password_hash VARCHAR(255),
    avatar_url VARCHAR(1000),
    role user_role NOT NULL DEFAULT 'org_member',
    language_pref VARCHAR(5) NOT NULL DEFAULT 'en',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    invited_by UUID REFERENCES users(id),
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE otp_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code VARCHAR(64) NOT NULL,
    channel otp_channel NOT NULL,
    purpose otp_purpose NOT NULL DEFAULT 'login',
    attempts INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    user_agent VARCHAR(500),
    ip_address TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID REFERENCES organizations(id),
    actor_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50),
    target_id UUID,
    metadata JSONB,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID REFERENCES organizations(id),
    name VARCHAR(255) NOT NULL,
    type group_type NOT NULL DEFAULT 'internal',
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE group_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_in_group group_member_role NOT NULL DEFAULT 'member',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(group_id, user_id)
);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id),
    receiver_id UUID REFERENCES users(id),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at TIMESTAMPTZ
);

CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    uploaded_by UUID NOT NULL REFERENCES users(id),
    group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
    filename VARCHAR(500) NOT NULL,
    storage_path VARCHAR(1000) NOT NULL,
    visibility doc_visibility NOT NULL DEFAULT 'all',
    password_hash VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE document_access (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(document_id, user_id)
);

-- Indexes
CREATE INDEX idx_group_members_group_user ON group_members(group_id, user_id);
CREATE INDEX idx_messages_group_created ON messages(group_id, created_at DESC);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_documents_group ON documents(group_id);
CREATE INDEX idx_documents_uploaded_by ON documents(uploaded_by);
CREATE INDEX idx_document_access_doc ON document_access(document_id);
CREATE INDEX idx_otp_codes_user ON otp_codes(user_id, created_at DESC);
CREATE INDEX idx_otp_codes_user_purpose ON otp_codes(user_id, purpose, created_at DESC);
CREATE INDEX idx_users_org ON users(org_id);
CREATE INDEX idx_users_org_email ON users(org_id, email);
CREATE INDEX idx_users_org_phone ON users(org_id, phone);
CREATE INDEX idx_groups_org ON groups(org_id);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_audit_org_created ON audit_logs(org_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_logs(actor_id);

-- Full-text search indexes
ALTER TABLE users ADD COLUMN name_search tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(name, ''))
) STORED;
CREATE INDEX idx_users_name_search ON users USING GIN(name_search);

ALTER TABLE groups ADD COLUMN name_search tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(name, ''))
) STORED;
CREATE INDEX idx_groups_name_search ON groups USING GIN(name_search);

ALTER TABLE messages ADD COLUMN content_search tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(content, ''))
) STORED;
CREATE INDEX idx_messages_content_search ON messages USING GIN(content_search);

ALTER TABLE documents ADD COLUMN filename_search tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(filename, ''))
) STORED;
CREATE INDEX idx_documents_filename_search ON documents USING GIN(filename_search);
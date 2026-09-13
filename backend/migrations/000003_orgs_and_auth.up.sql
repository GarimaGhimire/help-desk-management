-- Phase 1: Multi-tenancy + production auth foundation
-- (organizations, org-scoped users, real credentials, sessions, audit)

-- ------------------------------------------------------------------
-- Organizations (tenants) — banks/companies this platform serves
-- ------------------------------------------------------------------
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(120) UNIQUE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Roles: superadmin (Fintara platform), org_admin (company admin),
--        org_member (regular staff). Legacy 'employee' renamed.
ALTER TYPE user_role RENAME VALUE 'employee' TO 'org_member';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'org_admin';

-- ------------------------------------------------------------------
-- Users: tenant scoping + account lifecycle + auth state
-- ------------------------------------------------------------------
ALTER TABLE users
    ADD COLUMN org_id UUID REFERENCES organizations(id),
    ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN invited_by UUID REFERENCES users(id),
    ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN last_login_at TIMESTAMPTZ;

CREATE INDEX idx_users_org ON users(org_id);
CREATE INDEX idx_users_org_email ON users(org_id, email);
CREATE INDEX idx_users_org_phone ON users(org_id, phone);

-- ------------------------------------------------------------------
-- Groups belong to an organization
-- ------------------------------------------------------------------
ALTER TABLE groups ADD COLUMN org_id UUID REFERENCES organizations(id);
CREATE INDEX idx_groups_org ON groups(org_id);

ALTER TABLE groups ADD COLUMN name_search tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(name, ''))
) STORED;
CREATE INDEX idx_groups_name_search ON groups USING GIN(name_search);

-- ------------------------------------------------------------------
-- OTP codes: purposes (login / password reset), hashed codes, limits
-- ------------------------------------------------------------------
CREATE TYPE otp_purpose AS ENUM ('login', 'password_reset');

ALTER TABLE otp_codes
    ADD COLUMN purpose otp_purpose NOT NULL DEFAULT 'login',
    ADD COLUMN attempts INT NOT NULL DEFAULT 0;

-- codes now store SHA-256 hashes of the 6-digit code, never plaintext
ALTER TABLE otp_codes ALTER COLUMN code TYPE VARCHAR(64);

CREATE INDEX idx_otp_codes_user_purpose ON otp_codes(user_id, purpose, created_at DESC);

-- ------------------------------------------------------------------
-- Sessions: enable token revocation (logout / password change)
-- ------------------------------------------------------------------
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
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ------------------------------------------------------------------
-- Audit trail: who did what, when (required for banking deployments)
-- ------------------------------------------------------------------
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
CREATE INDEX idx_audit_org_created ON audit_logs(org_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_logs(actor_id);

-- ------------------------------------------------------------------
-- Seed: default tenant + working dev credentials
-- ------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO organizations (id, name, slug, created_by)
VALUES ('11111111-1111-4111-8111-111111111111', 'Fintara Helpdesk', 'fintara-helpdesk', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
ON CONFLICT (id) DO NOTHING;

-- Backfill existing groups into the default tenant
UPDATE groups SET org_id = '11111111-1111-4111-8111-111111111111' WHERE org_id IS NULL;

-- Staff: known temporary password, forced to change on first login
UPDATE users
SET org_id = '11111111-1111-4111-8111-111111111111',
    role = 'org_member',
    password_hash = crypt('Helpdesk@1234', gen_salt('bf', 10)),
    must_change_password = TRUE,
    invited_by = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
WHERE email IN ('ram@fintara.com', 'sita@fintara.com', 'hari@fintara.com') AND org_id IS NULL;

-- Superadmin: platform operator (no org)
UPDATE users
SET password_hash = crypt('Fintara@1234', gen_salt('bf', 10)),
    must_change_password = FALSE
WHERE email = 'admin@fintara.com' AND org_id IS NULL;
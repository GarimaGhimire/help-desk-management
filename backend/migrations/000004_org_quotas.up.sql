-- Phase 2: Organization quotas (payment plans) + platform superadmin

-- Companies subscribe to a plan expressed as quota columns.
-- NULL means "unlimited" on that dimension.
ALTER TABLE organizations
    ADD COLUMN staff_limit INTEGER,   -- max total accounts in the org (incl. org_admin)
    ADD COLUMN group_limit INTEGER;   -- max groups the org may create

-- Personal platform superadmin (operator account, no org).
-- Dev credential: superadmin@fintara.com / Fintara@Admin1
INSERT INTO users (id, name, email, phone, role, language_pref, password_hash, must_change_password, is_active, created_at)
VALUES (
    '30eebc99-9c0b-4ef8-bb6d-6bb9bd380a55',
    'Fintara Superadmin',
    'superadmin@fintara.com',
    '+977-9841000099',
    'superadmin',
    'en',
    crypt('Fintara@Admin1', gen_salt('bf', 10)),
    FALSE,
    TRUE,
    NOW()
)
ON CONFLICT (email) DO NOTHING;
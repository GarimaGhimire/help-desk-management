DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS sessions;

ALTER TABLE otp_codes DROP COLUMN IF EXISTS purpose;
ALTER TABLE otp_codes DROP COLUMN IF EXISTS attempts;
ALTER TABLE otp_codes ALTER COLUMN code TYPE VARCHAR(6);
DROP TYPE IF EXISTS otp_purpose;

ALTER TABLE groups DROP COLUMN IF EXISTS org_id;

ALTER TABLE users DROP COLUMN IF EXISTS org_id;
ALTER TABLE users DROP COLUMN IF EXISTS is_active;
ALTER TABLE users DROP COLUMN IF EXISTS invited_by;
ALTER TABLE users DROP COLUMN IF EXISTS must_change_password;
ALTER TABLE users DROP COLUMN IF EXISTS last_login_at;

-- NOTE: Postgres does not support dropping enum values.
-- 'org_admin' remains in the user_role enum; 'org_member' is renamed back.
ALTER TYPE user_role RENAME VALUE 'org_member' TO 'employee';

DROP TABLE IF EXISTS organizations;
DROP EXTENSION IF EXISTS pgcrypto;
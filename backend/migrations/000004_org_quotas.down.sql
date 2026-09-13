DELETE FROM users WHERE email = 'superadmin@fintara.com';

ALTER TABLE organizations
    DROP COLUMN IF EXISTS staff_limit,
    DROP COLUMN IF EXISTS group_limit;
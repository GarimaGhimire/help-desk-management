-- Migration 000009: Add custom document visibility and allowed_roles
ALTER TABLE documents ALTER COLUMN visibility TYPE VARCHAR(50);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS allowed_roles TEXT[] DEFAULT '{}';

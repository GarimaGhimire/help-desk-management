-- Replace filesystem storage_path with binary file storage in the database
-- Safe to re-run: uses IF EXISTS / IF NOT EXISTS guards

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS mime_type VARCHAR(255) NOT NULL DEFAULT 'application/octet-stream',
    ADD COLUMN IF NOT EXISTS file_data BYTEA NOT NULL DEFAULT '';

ALTER TABLE documents
    DROP COLUMN IF EXISTS storage_path;

ALTER TABLE documents
    ALTER COLUMN file_data DROP DEFAULT;

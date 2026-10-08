-- Revert: restore storage_path and remove binary storage columns
ALTER TABLE documents
    ADD COLUMN storage_path VARCHAR(1000) NOT NULL DEFAULT '',
    DROP COLUMN mime_type,
    DROP COLUMN file_data;

ALTER TABLE documents
    ALTER COLUMN storage_path DROP DEFAULT;

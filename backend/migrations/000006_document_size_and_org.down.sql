DROP INDEX IF EXISTS idx_documents_org;
ALTER TABLE documents DROP COLUMN IF EXISTS file_size;
ALTER TABLE documents DROP COLUMN IF EXISTS org_id;

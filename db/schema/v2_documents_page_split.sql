-- v2: support page-split uploads for documents
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS upload_group_id uuid,
  ADD COLUMN IF NOT EXISTS page_number integer,
  ADD COLUMN IF NOT EXISTS page_total integer,
  ADD COLUMN IF NOT EXISTS source_file_hash text;

CREATE INDEX IF NOT EXISTS idx_documents_upload_group_page
  ON documents (upload_group_id, page_number);

CREATE INDEX IF NOT EXISTS idx_documents_uploaded_at_desc
  ON documents (uploaded_at DESC);

-- Add maintenance mode fields to domain_mappings table
ALTER TABLE domain_mappings
ADD COLUMN IF NOT EXISTS maintenance_enabled BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS maintenance_page_path VARCHAR(500);

-- Add index for quick lookup of domains in maintenance
CREATE INDEX IF NOT EXISTS idx_domain_maintenance
ON domain_mappings(maintenance_enabled)
WHERE maintenance_enabled = TRUE;

-- Add bot_protection column to domain_mappings table
ALTER TABLE domain_mappings ADD COLUMN IF NOT EXISTS bot_protection VARCHAR(20) DEFAULT 'default';

-- Update existing rows to have 'default' value
UPDATE domain_mappings SET bot_protection = 'default' WHERE bot_protection IS NULL;

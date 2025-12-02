-- Migration: Add 2FA/TOTP support to users table

ALTER TABLE users ADD COLUMN IF NOT EXISTS twofa_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS twofa_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS twofa_backup_codes JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS twofa_verified_at TIMESTAMP;

-- Add or update the backends table to include health_status and related columns
CREATE TABLE IF NOT EXISTS backends (
  id SERIAL PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  target_host VARCHAR(255) NOT NULL,
  target_port INT NOT NULL,
  target_protocol VARCHAR(10) DEFAULT 'http',
  weight INT DEFAULT 1,
  health_status VARCHAR(10) DEFAULT 'unknown',
  last_health_check TIMESTAMP WITH TIME ZONE,
  consecutive_failures INT DEFAULT 0,
  active_connections INT DEFAULT 0,
  total_requests INT DEFAULT 0,
  avg_response_time_ms INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Migration: add missing columns if not present (safe for repeated runs)
DO $$ BEGIN
  BEGIN ALTER TABLE backends ADD COLUMN IF NOT EXISTS weight INT DEFAULT 1; EXCEPTION WHEN duplicate_column THEN END;
  BEGIN ALTER TABLE backends ADD COLUMN IF NOT EXISTS health_status VARCHAR(10) DEFAULT 'unknown'; EXCEPTION WHEN duplicate_column THEN END;
  BEGIN ALTER TABLE backends ADD COLUMN IF NOT EXISTS last_health_check TIMESTAMP WITH TIME ZONE; EXCEPTION WHEN duplicate_column THEN END;
  BEGIN ALTER TABLE backends ADD COLUMN IF NOT EXISTS consecutive_failures INT DEFAULT 0; EXCEPTION WHEN duplicate_column THEN END;
  BEGIN ALTER TABLE backends ADD COLUMN IF NOT EXISTS active_connections INT DEFAULT 0; EXCEPTION WHEN duplicate_column THEN END;
  BEGIN ALTER TABLE backends ADD COLUMN IF NOT EXISTS total_requests INT DEFAULT 0; EXCEPTION WHEN duplicate_column THEN END;
  BEGIN ALTER TABLE backends ADD COLUMN IF NOT EXISTS avg_response_time_ms INT DEFAULT 0; EXCEPTION WHEN duplicate_column THEN END;
END $$;

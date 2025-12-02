-- Migration 001: Add Load Balancing Support
-- This migration adds support for multiple backends per domain with load balancing algorithms

-- Add weight and health status to backends table
ALTER TABLE backends ADD COLUMN IF NOT EXISTS weight INT DEFAULT 1;
ALTER TABLE backends ADD COLUMN IF NOT EXISTS health_status VARCHAR(20) DEFAULT 'unknown';
ALTER TABLE backends ADD COLUMN IF NOT EXISTS last_health_check TIMESTAMP WITH TIME ZONE;
ALTER TABLE backends ADD COLUMN IF NOT EXISTS consecutive_failures INT DEFAULT 0;
ALTER TABLE backends ADD COLUMN IF NOT EXISTS active_connections INT DEFAULT 0;
ALTER TABLE backends ADD COLUMN IF NOT EXISTS total_requests BIGINT DEFAULT 0;
ALTER TABLE backends ADD COLUMN IF NOT EXISTS avg_response_time_ms INT DEFAULT 0;

-- Create backend_pools table for grouping backends
CREATE TABLE IF NOT EXISTS backend_pools(
  id SERIAL PRIMARY KEY,
  name VARCHAR(191) NOT NULL UNIQUE,
  lb_algorithm VARCHAR(50) NOT NULL DEFAULT 'round-robin',
  health_check_enabled BOOLEAN DEFAULT TRUE,
  health_check_interval_ms INT DEFAULT 30000,
  health_check_path VARCHAR(255) DEFAULT '/',
  health_check_timeout_ms INT DEFAULT 2000,
  max_failures INT DEFAULT 3,
  failure_timeout_ms INT DEFAULT 60000,
  sticky_sessions BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

COMMENT ON COLUMN backend_pools.lb_algorithm IS 'Load balancing algorithm: round-robin, least-connections, weighted, ip-hash';

-- Create junction table for backend_pool membership
CREATE TABLE IF NOT EXISTS backend_pool_members(
  id SERIAL PRIMARY KEY,
  pool_id INT NOT NULL REFERENCES backend_pools(id) ON DELETE CASCADE,
  backend_id INT NOT NULL REFERENCES backends(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT TRUE,
  priority INT DEFAULT 100,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(pool_id, backend_id)
);

-- Add pool_id to domain_mappings (optional, can use direct backend_id or pool)
ALTER TABLE domain_mappings ADD COLUMN IF NOT EXISTS backend_pool_id INT REFERENCES backend_pools(id) ON DELETE SET NULL;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_backend_pool_members_pool ON backend_pool_members(pool_id);
CREATE INDEX IF NOT EXISTS idx_backend_pool_members_backend ON backend_pool_members(backend_id);
CREATE INDEX IF NOT EXISTS idx_domain_mappings_pool ON domain_mappings(backend_pool_id);
CREATE INDEX IF NOT EXISTS idx_backends_health_status ON backends(health_status);

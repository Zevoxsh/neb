-- Monthly Reports Table
CREATE TABLE IF NOT EXISTS monthly_reports (
  id SERIAL PRIMARY KEY,
  report_month DATE NOT NULL UNIQUE, -- First day of the month being reported
  generated_at TIMESTAMP DEFAULT NOW(),
  
  -- Domain Statistics
  domains_total INTEGER DEFAULT 0,
  domains_added INTEGER DEFAULT 0,
  domains_deleted INTEGER DEFAULT 0,
  
  -- Proxy Statistics
  proxies_total INTEGER DEFAULT 0,
  proxies_added INTEGER DEFAULT 0,
  proxies_deleted INTEGER DEFAULT 0,
  
  -- Backend Statistics
  backends_total INTEGER DEFAULT 0,
  backends_added INTEGER DEFAULT 0,
  backends_deleted INTEGER DEFAULT 0,
  
  -- Request Statistics
  total_requests BIGINT DEFAULT 0,
  unique_ips INTEGER DEFAULT 0,
  unique_domains INTEGER DEFAULT 0,
  
  -- Security Statistics
  total_alerts INTEGER DEFAULT 0,
  blocked_ips INTEGER DEFAULT 0,
  trusted_ips INTEGER DEFAULT 0,
  
  -- Certificate Statistics
  active_certificates INTEGER DEFAULT 0,
  certificates_issued INTEGER DEFAULT 0,
  certificates_renewed INTEGER DEFAULT 0,
  
  -- User Statistics
  total_users INTEGER DEFAULT 0,
  active_users INTEGER DEFAULT 0,
  
  -- Raw JSON for additional data
  additional_data JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_monthly_reports_month ON monthly_reports(report_month DESC);

-- Table to track previous month's counts for comparison
CREATE TABLE IF NOT EXISTS monthly_snapshots (
  id SERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL UNIQUE,
  domains_count INTEGER DEFAULT 0,
  proxies_count INTEGER DEFAULT 0,
  backends_count INTEGER DEFAULT 0,
  certificates_count INTEGER DEFAULT 0,
  users_count INTEGER DEFAULT 0
);

CREATE INDEX idx_monthly_snapshots_date ON monthly_snapshots(snapshot_date DESC);

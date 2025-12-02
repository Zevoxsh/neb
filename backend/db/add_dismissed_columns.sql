-- Add dismissed_at column to security_alerts table
ALTER TABLE security_alerts 
ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Add dismissed_at column to request_logs table  
ALTER TABLE request_logs
ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_security_alerts_dismissed ON security_alerts(dismissed_at);
CREATE INDEX IF NOT EXISTS idx_request_logs_dismissed ON request_logs(dismissed_at);

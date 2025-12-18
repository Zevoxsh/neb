-- PostgreSQL-compatible users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(191) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Proxies table
CREATE TABLE IF NOT EXISTS proxies (
  id SERIAL PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  listen_host VARCHAR(100) NOT NULL,
  listen_port INT NOT NULL,
  target_host VARCHAR(255) NOT NULL,
  target_port INT NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(191) PRIMARY KEY,
    value TEXT
);

-- You can create a user with the provided `create-user.js` script:
-- psql -h <host> -p <port> -U <user> -d <db> -f backend/db/init.sql

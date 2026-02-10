require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const schema = `
CREATE TABLE IF NOT EXISTS hosts (
  id SERIAL PRIMARY KEY,
  ip_address INET NOT NULL UNIQUE,
  hostname VARCHAR(255),
  mac_address VARCHAR(17),
  vendor VARCHAR(255),
  os_guess VARCHAR(255),
  status VARCHAR(20) DEFAULT 'up',
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS services (
  id SERIAL PRIMARY KEY,
  host_id INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
  port INTEGER NOT NULL,
  protocol VARCHAR(10) DEFAULT 'tcp',
  state VARCHAR(20) DEFAULT 'open',
  service_name VARCHAR(100),
  service_product VARCHAR(255),
  service_version VARCHAR(100),
  service_info TEXT,
  banner TEXT,
  http_title VARCHAR(500),
  http_server VARCHAR(255),
  identified_as VARCHAR(255),
  extra_info JSONB DEFAULT '{}',
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(host_id, port, protocol)
);

CREATE TABLE IF NOT EXISTS scans (
  id SERIAL PRIMARY KEY,
  network VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'running',
  hosts_found INTEGER DEFAULT 0,
  services_found INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  error TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  description VARCHAR(255),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO settings (key, value, description) VALUES
  ('scan_network', '192.168.66.0/24', 'Network CIDR to scan'),
  ('scan_interval', '30', 'Scan interval in minutes'),
  ('scan_ports', '1-10000', 'Port range to scan'),
  ('scan_enabled', 'true', 'Enable automatic scanning')
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_hosts_ip ON hosts(ip_address);
CREATE INDEX IF NOT EXISTS idx_hosts_status ON hosts(status);
CREATE INDEX IF NOT EXISTS idx_services_host ON services(host_id);
CREATE INDEX IF NOT EXISTS idx_services_port ON services(port);
CREATE INDEX IF NOT EXISTS idx_services_state ON services(state);
CREATE INDEX IF NOT EXISTS idx_services_last_seen ON services(last_seen);
CREATE INDEX IF NOT EXISTS idx_services_host_state ON services(host_id, state);
CREATE INDEX IF NOT EXISTS idx_scans_status ON scans(status);
CREATE INDEX IF NOT EXISTS idx_scans_started_at ON scans(started_at DESC);

CREATE TABLE IF NOT EXISTS host_availability (
  id BIGSERIAL PRIMARY KEY,
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(10) NOT NULL CHECK (status IN ('up', 'down'))
);
CREATE INDEX IF NOT EXISTS idx_availability_host_checked ON host_availability (host_id, checked_at);
CREATE INDEX IF NOT EXISTS idx_availability_checked ON host_availability (checked_at);

DO $$ BEGIN
  ALTER TABLE hosts ADD COLUMN device_type VARCHAR(50) DEFAULT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE hosts ADD COLUMN parent_host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_hosts_parent ON hosts(parent_host_id);
CREATE INDEX IF NOT EXISTS idx_hosts_device_type ON hosts(device_type);
`;

async function initDatabase() {
  try {
    await pool.query(schema);
    console.log('Database schema initialized successfully');
  } catch (err) {
    console.error('Failed to initialize database:', err.message);
    throw err;
  } finally {
    await pool.end();
  }
}

initDatabase();

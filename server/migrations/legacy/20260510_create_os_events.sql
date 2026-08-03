CREATE TABLE IF NOT EXISTS os_events (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  os_id INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(80) NOT NULL,
  title VARCHAR(160) NOT NULL,
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_os_events_company_os_created
ON os_events (company_id, os_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_os_events_os_id
ON os_events (os_id);
-- BrownSpot core schema (local Homebrew Postgres)
CREATE TABLE IF NOT EXISTS users (
  id              BIGSERIAL PRIMARY KEY,
  clerk_user_id   TEXT NOT NULL UNIQUE,
  email           TEXT,
  first_name      TEXT,
  last_name       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_events (
  id              BIGSERIAL PRIMARY KEY,
  clerk_user_id   TEXT NOT NULL,
  event           TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events (clerk_user_id);

-- Extensible agent command catalog (add rows later; agent discovers via tools)
CREATE TABLE IF NOT EXISTS agent_commands (
  id              BIGSERIAL PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  category        TEXT NOT NULL DEFAULT 'general',
  -- shell_template: run interpolated shell; builtin: reserved for future handlers
  handler_type    TEXT NOT NULL DEFAULT 'shell_template'
                    CHECK (handler_type IN ('shell_template', 'builtin')),
  -- Shell with {{param}} placeholders only (no raw user shell paste into template from DB admin care)
  template        TEXT,
  -- JSON Schema-ish: { "params": [ { "name": "message", "required": true, "description": "..." } ] }
  params_schema   JSONB NOT NULL DEFAULT '{"params":[]}'::jsonb,
  risk_level      TEXT NOT NULL DEFAULT 'medium'
                    CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INT NOT NULL DEFAULT 100,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_commands_category ON agent_commands (category);
CREATE INDEX IF NOT EXISTS idx_agent_commands_enabled ON agent_commands (enabled);

CREATE TABLE IF NOT EXISTS agent_command_runs (
  id              BIGSERIAL PRIMARY KEY,
  command_slug    TEXT NOT NULL,
  clerk_user_id   TEXT,
  params          JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_cmd    TEXT,
  exit_code       INT,
  stdout_excerpt  TEXT,
  stderr_excerpt  TEXT,
  success         BOOLEAN,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_command_runs_slug ON agent_command_runs (command_slug);
CREATE INDEX IF NOT EXISTS idx_agent_command_runs_user ON agent_command_runs (clerk_user_id);

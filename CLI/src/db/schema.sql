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

-- Reference + active project RAG (FTS default; optional embeddings)
CREATE TABLE IF NOT EXISTS reference_projects (
  id                BIGSERIAL PRIMARY KEY,
  clerk_user_id     TEXT NOT NULL,
  slug              TEXT NOT NULL,
  label             TEXT NOT NULL DEFAULT '',
  local_path        TEXT NOT NULL,
  project_role      TEXT NOT NULL DEFAULT 'reference'
                      CHECK (project_role IN ('reference', 'active')),
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  is_primary        BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order        INT NOT NULL DEFAULT 100,
  last_ingest_at    TIMESTAMPTZ,
  last_content_hash TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clerk_user_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_reference_projects_user
  ON reference_projects (clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_reference_projects_role
  ON reference_projects (clerk_user_id, project_role);

CREATE TABLE IF NOT EXISTS project_snapshots (
  id           BIGSERIAL PRIMARY KEY,
  project_id   BIGINT NOT NULL REFERENCES reference_projects(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'running', 'ok', 'error', 'skipped')),
  file_count   INT NOT NULL DEFAULT 0,
  chunk_count  INT NOT NULL DEFAULT 0,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_snapshots_project
  ON project_snapshots (project_id);

CREATE TABLE IF NOT EXISTS project_chunks (
  id             BIGSERIAL PRIMARY KEY,
  project_id     BIGINT NOT NULL REFERENCES reference_projects(id) ON DELETE CASCADE,
  snapshot_id    BIGINT REFERENCES project_snapshots(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL DEFAULT 'file',
  path           TEXT NOT NULL DEFAULT '',
  title          TEXT,
  content        TEXT NOT NULL DEFAULT '',
  content_hash   TEXT NOT NULL DEFAULT '',
  search_vector  tsvector
                   GENERATED ALWAYS AS (
                     to_tsvector(
                       'english',
                       coalesce(title, '') || ' ' || coalesce(content, '')
                     )
                   ) STORED,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_chunks_project ON project_chunks (project_id);
CREATE INDEX IF NOT EXISTS idx_project_chunks_fts ON project_chunks USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_project_chunks_hash ON project_chunks (project_id, content_hash);

CREATE TABLE IF NOT EXISTS project_embeddings (
  id         BIGSERIAL PRIMARY KEY,
  chunk_id   BIGINT NOT NULL REFERENCES project_chunks(id) ON DELETE CASCADE,
  model      TEXT NOT NULL,
  dims       INT NOT NULL,
  embedding  REAL[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chunk_id, model)
);

CREATE INDEX IF NOT EXISTS idx_project_embeddings_chunk ON project_embeddings (chunk_id);

CREATE TABLE IF NOT EXISTS project_profiles (
  project_id  BIGINT PRIMARY KEY REFERENCES reference_projects(id) ON DELETE CASCADE,
  summary_md  TEXT NOT NULL DEFAULT '',
  style_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_events (
  id           BIGSERIAL PRIMARY KEY,
  project_id   BIGINT NOT NULL REFERENCES reference_projects(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL
                 CHECK (event_type IN (
                   'added', 'ingested', 'reindexed', 'removed', 'activated'
                 )),
  snapshot_id  BIGINT REFERENCES project_snapshots(id) ON DELETE SET NULL,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_events_project ON project_events (project_id);
CREATE INDEX IF NOT EXISTS idx_project_events_type ON project_events (event_type);

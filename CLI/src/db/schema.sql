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

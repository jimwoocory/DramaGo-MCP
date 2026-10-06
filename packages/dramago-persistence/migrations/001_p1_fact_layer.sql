BEGIN;

CREATE SCHEMA IF NOT EXISTS dramago;

CREATE TABLE IF NOT EXISTS dramago.projects (
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  project_id text PRIMARY KEY,
  revision bigint NOT NULL CHECK (revision >= 0),
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dramago_projects_workspace_idx ON dramago.projects(tenant_id, workspace_id);

CREATE TABLE IF NOT EXISTS dramago.project_members (
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  project_id text NOT NULL REFERENCES dramago.projects(project_id) ON DELETE RESTRICT,
  principal_id text NOT NULL,
  roles text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY(project_id, principal_id)
);

CREATE TABLE IF NOT EXISTS dramago.artifact_versions (
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  project_id text NOT NULL REFERENCES dramago.projects(project_id) ON DELETE RESTRICT,
  artifact_id text NOT NULL,
  version_id text PRIMARY KEY,
  content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[0-9a-f]{64}$'),
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, artifact_id, version_id)
);
CREATE INDEX IF NOT EXISTS dramago_artifact_versions_artifact_idx ON dramago.artifact_versions(project_id, artifact_id, created_at);

CREATE TABLE IF NOT EXISTS dramago.baselines (
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  project_id text NOT NULL REFERENCES dramago.projects(project_id) ON DELETE RESTRICT,
  baseline_id text PRIMARY KEY,
  baseline_kind text NOT NULL CHECK (baseline_kind IN ('planning','script')),
  artifact_id text NOT NULL,
  version_id text NOT NULL UNIQUE,
  content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[0-9a-f]{64}$'),
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dramago.baseline_items (
  baseline_id text NOT NULL REFERENCES dramago.baselines(baseline_id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position >= 0),
  episode_id text NOT NULL,
  role text NOT NULL,
  artifact_id text NOT NULL,
  version_id text NOT NULL REFERENCES dramago.artifact_versions(version_id) ON DELETE RESTRICT,
  content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[0-9a-f]{64}$'),
  PRIMARY KEY(baseline_id, position),
  UNIQUE(baseline_id, episode_id, role)
);

CREATE TABLE IF NOT EXISTS dramago.approval_decisions (
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  project_id text NOT NULL REFERENCES dramago.projects(project_id) ON DELETE RESTRICT,
  approval_id text PRIMARY KEY,
  version_id text NOT NULL UNIQUE,
  decision text NOT NULL CHECK (decision IN ('approved','rejected','revoked')),
  target_refs jsonb NOT NULL,
  body jsonb NOT NULL,
  decided_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS dramago_approval_target_gin ON dramago.approval_decisions USING gin(target_refs);

CREATE TABLE IF NOT EXISTS dramago.creative_runs (
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  project_id text NOT NULL REFERENCES dramago.projects(project_id) ON DELETE RESTRICT,
  run_id text PRIMARY KEY,
  domain text NOT NULL CHECK (domain IN ('story','script','production')),
  revision bigint NOT NULL CHECK (revision >= 0),
  status text NOT NULL CHECK (status IN ('queued','running','waiting_approval','succeeded','failed','cancelled')),
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dramago.idempotency_records (
  tenant_id text NOT NULL,
  scope_key text NOT NULL,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id, scope_key, idempotency_key)
);

CREATE TABLE IF NOT EXISTS dramago.audit_log (
  event_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dramago.outbox (
  event_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text,
  event_type text NOT NULL,
  body jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS dramago_outbox_pending_idx ON dramago.outbox(available_at) WHERE processed_at IS NULL;

COMMIT;

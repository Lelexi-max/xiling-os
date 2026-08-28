import type { DatabaseSync } from "node:sqlite";

const migrations: Array<{ version: number; sql: string }> = [{
  version: 1,
  sql: `
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, research_question TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS project_items (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), kind TEXT NOT NULL, title TEXT NOT NULL, notes TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS wiki_pages (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), slug TEXT NOT NULL, title TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(project_id, slug));
    CREATE TABLE IF NOT EXISTS wiki_revisions (id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES wiki_pages(id), version INTEGER NOT NULL, markdown TEXT NOT NULL, artifact_uris TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(page_id, version));
    CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), paper_id TEXT NOT NULL, paper_json TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(project_id, paper_id));
    CREATE TABLE IF NOT EXISTS chat_sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES chat_sessions(id), role TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chat_session_contexts (session_id TEXT PRIMARY KEY REFERENCES chat_sessions(id), active_node_id TEXT NOT NULL, quoted_node_ids TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS context_capsules (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), source_node_id TEXT NOT NULL, layer TEXT NOT NULL, source_revision TEXT NOT NULL, summary TEXT NOT NULL, claims TEXT NOT NULL, artifact_uris TEXT NOT NULL, covered_node_ids TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS context_capsules_project_layer ON context_capsules(project_id, layer);
    CREATE INDEX IF NOT EXISTS chat_sessions_project_updated ON chat_sessions(project_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS chat_messages_session_created ON chat_messages(session_id, created_at ASC);
    CREATE VIRTUAL TABLE IF NOT EXISTS wiki_search USING fts5(page_id UNINDEXED, title, markdown, tokenize='unicode61');
  `,
}, {
  version: 2,
  sql: `
    CREATE TABLE IF NOT EXISTS research_projection_outbox (
      id TEXT PRIMARY KEY,
      projection_key TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL REFERENCES projects(id),
      source_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      applied_at TEXT
    );
    CREATE INDEX IF NOT EXISTS research_projection_outbox_pending
      ON research_projection_outbox(applied_at, created_at);
  `,
}, {
  version: 3,
  sql: `
    ALTER TABLE evidence ADD COLUMN stance TEXT NOT NULL DEFAULT 'insufficient';
    ALTER TABLE evidence ADD COLUMN confidence REAL NOT NULL DEFAULT 0.5;
  `,
}, {
  version: 4,
  sql: `
    CREATE TABLE evidence_v4 (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      paper_id TEXT NOT NULL,
      paper_json TEXT NOT NULL,
      note TEXT NOT NULL,
      stance TEXT NOT NULL DEFAULT 'insufficient',
      confidence REAL NOT NULL DEFAULT 0.5,
      source_quote TEXT NOT NULL DEFAULT '',
      source_locator TEXT,
      limitations TEXT NOT NULL DEFAULT '',
      claim_revision_id TEXT,
      created_at TEXT NOT NULL
    );
    INSERT INTO evidence_v4 (id, project_id, paper_id, paper_json, note, stance, confidence, created_at)
      SELECT id, project_id, paper_id, paper_json, note, stance, confidence, created_at FROM evidence;
    DROP TABLE evidence;
    ALTER TABLE evidence_v4 RENAME TO evidence;
    CREATE INDEX evidence_project_paper ON evidence(project_id, paper_id);
  `,
}, {
  version: 5,
  sql: `
    ALTER TABLE projects ADD COLUMN domain_ids TEXT NOT NULL DEFAULT '["general-science"]';
    UPDATE projects SET domain_ids = '["general-science","ocean-climate"]' WHERE id = 'ocean-heatwave';
  `,
}, {
  version: 6,
  sql: `
    -- Every project created before domain support belonged to the original
    -- ocean-first product. New projects are created only after this migration
    -- and therefore keep their explicit user selection.
    UPDATE projects SET domain_ids = '["general-science","ocean-climate"]'
      WHERE domain_ids = '["general-science"]';
  `,
}, {
  version: 7,
  sql: `
    DROP INDEX IF EXISTS chat_messages_session_created;
    DROP TABLE IF EXISTS chat_messages;
  `,
}];

export const KNOWLEDGE_SCHEMA_VERSION = migrations.at(-1)?.version ?? 0;

export function runKnowledgeMigrations(sqlite: DatabaseSync): number {
  const row = sqlite.prepare("PRAGMA user_version").get() as { user_version: number };
  let current = row.user_version;
  if (current > KNOWLEDGE_SCHEMA_VERSION) throw new Error(`Knowledge database version ${current} is newer than supported ${KNOWLEDGE_SCHEMA_VERSION}`);
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      sqlite.exec(migration.sql);
      sqlite.exec(`PRAGMA user_version = ${migration.version}`);
      sqlite.exec("COMMIT");
      current = migration.version;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  return current;
}

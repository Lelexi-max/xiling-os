import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text().primaryKey(),
  name: text().notNull(),
  description: text().notNull(),
  researchQuestion: text("research_question").notNull(),
  domainIds: text("domain_ids").notNull().default('["general-science"]'),
  status: text().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const projectItems = sqliteTable("project_items", {
  id: text().primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  kind: text().notNull(),
  title: text().notNull(),
  notes: text().notNull(),
  status: text().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const wikiPages = sqliteTable("wiki_pages", {
  id: text().primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  slug: text().notNull(),
  title: text().notNull(),
  archived: integer({ mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("wiki_project_slug").on(table.projectId, table.slug)]);

export const wikiRevisions = sqliteTable("wiki_revisions", {
  id: text().primaryKey(),
  pageId: text("page_id").notNull().references(() => wikiPages.id),
  version: integer().notNull(),
  markdown: text().notNull(),
  artifactUris: text("artifact_uris").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("wiki_page_version").on(table.pageId, table.version)]);

export const evidence = sqliteTable("evidence", {
  id: text().primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  paperId: text("paper_id").notNull(),
  paperJson: text("paper_json").notNull(),
  note: text().notNull(),
  stance: text().notNull().default("insufficient"),
  confidence: real().notNull().default(0.5),
  sourceQuote: text("source_quote").notNull().default(""),
  sourceLocator: text("source_locator"),
  limitations: text().notNull().default(""),
  claimRevisionId: text("claim_revision_id"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("evidence_project_paper").on(table.projectId, table.paperId)]);

export const chatSessions = sqliteTable("chat_sessions", {
  id: text().primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  title: text().notNull(),
  archived: integer({ mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text().primaryKey(),
  sessionId: text("session_id").notNull().references(() => chatSessions.id),
  role: text().notNull(),
  text: text().notNull(),
  status: text().notNull(),
  createdAt: text("created_at").notNull(),
});

export const chatSessionContexts = sqliteTable("chat_session_contexts", {
  sessionId: text("session_id").primaryKey().references(() => chatSessions.id),
  activeNodeId: text("active_node_id").notNull(),
  quotedNodeIds: text("quoted_node_ids").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const contextCapsules = sqliteTable("context_capsules", {
  id: text().primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  sourceNodeId: text("source_node_id").notNull(),
  layer: text().notNull(),
  sourceRevision: text("source_revision").notNull(),
  summary: text().notNull(),
  claims: text().notNull(),
  artifactUris: text("artifact_uris").notNull(),
  coveredNodeIds: text("covered_node_ids").notNull(),
  updatedAt: text("updated_at").notNull(),
});

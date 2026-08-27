import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ResearchGraphProposal, ResearchGraphProposalAction, ResearchGraphProposalStatus } from "@xiling/contracts";

type ProposalRow = {
  id: string;
  project_id: string;
  action_json: string;
  status: string;
  created_at: string;
  decided_at: string | null;
  applied_entity_ids_json: string;
};

function fromRow(row: ProposalRow): ResearchGraphProposal {
  return {
    id: row.id,
    projectId: row.project_id,
    action: JSON.parse(row.action_json) as ResearchGraphProposalAction,
    status: row.status as ResearchGraphProposalStatus,
    createdAt: row.created_at,
    ...(row.decided_at ? { decidedAt: row.decided_at } : {}),
    appliedEntityIds: JSON.parse(row.applied_entity_ids_json) as string[],
  };
}

export class ResearchGraphProposalStore {
  private readonly sqlite: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS research_graph_proposals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        action_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        decided_at TEXT,
        applied_entity_ids_json TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS research_graph_proposals_project_created
        ON research_graph_proposals(project_id, created_at DESC);
    `);
  }

  create(projectId: string, action: ResearchGraphProposalAction): ResearchGraphProposal {
    const proposal: ResearchGraphProposal = {
      id: randomUUID(), projectId, action, status: "pending", createdAt: new Date().toISOString(), appliedEntityIds: [],
    };
    this.sqlite.prepare(`INSERT INTO research_graph_proposals
      (id, project_id, action_json, status, created_at, applied_entity_ids_json)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(proposal.id, proposal.projectId, JSON.stringify(proposal.action), proposal.status, proposal.createdAt, "[]");
    return proposal;
  }

  get(projectId: string, id: string): ResearchGraphProposal | undefined {
    const row = this.sqlite.prepare("SELECT * FROM research_graph_proposals WHERE project_id = ? AND id = ?").get(projectId, id) as ProposalRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  list(projectId: string): ResearchGraphProposal[] {
    return (this.sqlite.prepare("SELECT * FROM research_graph_proposals WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as ProposalRow[]).map(fromRow);
  }

  decide(projectId: string, id: string, status: Exclude<ResearchGraphProposalStatus, "pending">, appliedEntityIds: string[] = []): ResearchGraphProposal | undefined {
    const timestamp = new Date().toISOString();
    const result = this.sqlite.prepare(`UPDATE research_graph_proposals
      SET status = ?, decided_at = ?, applied_entity_ids_json = ?
      WHERE project_id = ? AND id = ? AND status = 'pending'`)
      .run(status, timestamp, JSON.stringify(appliedEntityIds), projectId, id);
    return result.changes ? this.get(projectId, id) : undefined;
  }

  close(): void { this.sqlite.close(); }
}

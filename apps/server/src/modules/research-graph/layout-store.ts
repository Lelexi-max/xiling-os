import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { ResearchGraphView, ScientificCanvasLayout, ScientificCanvasPosition, ScientificCanvasViewport } from "@xiling/contracts";

type LayoutRow = { revision: number; viewport_json: string | null; updated_at: string };
type PositionRow = { entity_id: string; x: number; y: number };

export class ScientificCanvasLayoutConflictError extends Error {
  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super(`Scientific Canvas layout revision conflict: expected ${expectedRevision}, current ${actualRevision}`);
  }
}

export class ScientificCanvasLayoutStore {
  private readonly sqlite: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS scientific_canvas_layouts (
        project_id TEXT NOT NULL,
        view TEXT NOT NULL,
        revision INTEGER NOT NULL,
        viewport_json TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, view)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS scientific_canvas_positions (
        project_id TEXT NOT NULL,
        view TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, view, entity_id),
        FOREIGN KEY (project_id, view) REFERENCES scientific_canvas_layouts(project_id, view) ON DELETE CASCADE
      ) STRICT;
    `);
  }

  get(projectId: string, view: ResearchGraphView): ScientificCanvasLayout {
    const row = this.sqlite.prepare("SELECT revision, viewport_json, updated_at FROM scientific_canvas_layouts WHERE project_id = ? AND view = ?").get(projectId, view) as LayoutRow | undefined;
    if (!row) return { projectId, view, revision: 0, positions: [] };
    const positions = this.sqlite.prepare("SELECT entity_id, x, y FROM scientific_canvas_positions WHERE project_id = ? AND view = ? ORDER BY entity_id").all(projectId, view) as PositionRow[];
    const viewport = row.viewport_json ? JSON.parse(row.viewport_json) as ScientificCanvasViewport : undefined;
    return {
      projectId,
      view,
      revision: row.revision,
      positions: positions.map((position) => ({ entityId: position.entity_id, x: position.x, y: position.y })),
      ...(viewport ? { viewport } : {}),
      updatedAt: row.updated_at,
    };
  }

  save(input: { projectId: string; view: ResearchGraphView; revision: number; positions: ScientificCanvasPosition[]; viewport?: ScientificCanvasViewport }): ScientificCanvasLayout {
    const now = new Date().toISOString();
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const current = this.sqlite.prepare("SELECT revision FROM scientific_canvas_layouts WHERE project_id = ? AND view = ?").get(input.projectId, input.view) as { revision: number } | undefined;
      const actualRevision = current?.revision ?? 0;
      if (input.revision !== actualRevision) throw new ScientificCanvasLayoutConflictError(input.revision, actualRevision);
      const nextRevision = actualRevision + 1;
      this.sqlite.prepare(`
        INSERT INTO scientific_canvas_layouts (project_id, view, revision, viewport_json, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(project_id, view) DO UPDATE SET revision = excluded.revision, viewport_json = excluded.viewport_json, updated_at = excluded.updated_at
      `).run(input.projectId, input.view, nextRevision, input.viewport ? JSON.stringify(input.viewport) : null, now);
      this.sqlite.prepare("DELETE FROM scientific_canvas_positions WHERE project_id = ? AND view = ?").run(input.projectId, input.view);
      const insert = this.sqlite.prepare("INSERT INTO scientific_canvas_positions (project_id, view, entity_id, x, y, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
      for (const position of input.positions) insert.run(input.projectId, input.view, position.entityId, position.x, position.y, now);
      this.sqlite.exec("COMMIT");
      return this.get(input.projectId, input.view);
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void { this.sqlite.close(); }
}

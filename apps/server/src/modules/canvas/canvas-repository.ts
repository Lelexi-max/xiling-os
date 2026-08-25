import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CanvasEdge, CanvasGraphDocument } from "@xiling/contracts";
import { canvasGraphSchema, canvasLayoutSchema } from "@xiling/api-contracts";
import { z } from "zod";

export class CanvasRevisionConflict extends Error {
  constructor(readonly expected: number, readonly actual: number) { super(`Canvas revision conflict: expected ${expected}, actual ${actual}`); }
}

export function inferCanvasEdges(layout: z.infer<typeof canvasLayoutSchema>): CanvasEdge[] {
  const edges: CanvasEdge[] = [
    { id: "edge-question-decompose", source: "question", target: "decompose", kind: "follow-up" },
    { id: "edge-decompose-literature", source: "decompose", target: "literature", kind: "follow-up" },
    { id: "edge-decompose-dataset", source: "decompose", target: "dataset", kind: "follow-up" },
  ];
  for (const node of layout) {
    if (["question", "decompose", "literature", "dataset"].includes(node.id)) continue;
    const eyebrow = node.data?.eyebrow ?? "";
    const edge = node.id.startsWith("workflow-") || eyebrow === "RESEARCH WORKFLOW"
      ? { id: `edge-dataset-${node.id}`, source: "dataset", target: node.id, kind: "produced" as const }
      : node.id.startsWith("paper-") || eyebrow === "EVIDENCE PAPER"
        ? { id: `edge-literature-${node.id}`, source: "literature", target: node.id, kind: "quote" as const }
        : eyebrow === "AGENT CHECKPOINT"
          ? { id: `edge-decompose-${node.id}`, source: "decompose", target: node.id, kind: "checkpoint" as const }
          : { id: `edge-decompose-${node.id}`, source: "decompose", target: node.id, kind: "follow-up" as const };
    edges.push(edge);
  }
  return edges;
}

export function assertCanvasGraphAcyclic(graph: CanvasGraphDocument): void {
  const ids = new Set(graph.nodes.map((node) => node.id));
  const children = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of graph.edges) if (edge.kind !== "quote" && ids.has(edge.source) && ids.has(edge.target)) children.get(edge.source)!.push(edge.target);
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error(`Canvas parent cycle detected at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id); for (const child of children.get(id) ?? []) visit(child); visiting.delete(id); visited.add(id);
  };
  for (const id of ids) visit(id);
}

export interface CanvasRepository {
  read(projectId: string): Promise<CanvasGraphDocument>;
  save(projectId: string, graph: CanvasGraphDocument, expectedRevision?: number): Promise<CanvasGraphDocument>;
  update(projectId: string, updater: (graph: CanvasGraphDocument) => CanvasGraphDocument): Promise<CanvasGraphDocument>;
}

export class FileCanvasRepository implements CanvasRepository {
  private readonly writes = new Map<string, Promise<unknown>>();
  constructor(private readonly options: { root: string; legacyPath: string; defaultProjectId: string; baseNodes: (projectId: string) => CanvasGraphDocument["nodes"] }) {}

  async read(projectId: string): Promise<CanvasGraphDocument> {
    return this.materialize(projectId, await this.readStored(projectId));
  }

  async save(projectId: string, graph: CanvasGraphDocument, expectedRevision?: number): Promise<CanvasGraphDocument> {
    return this.serialize(projectId, async () => this.saveUnlocked(projectId, graph, expectedRevision));
  }

  async update(projectId: string, updater: (graph: CanvasGraphDocument) => CanvasGraphDocument): Promise<CanvasGraphDocument> {
    return this.serialize(projectId, async () => {
      const current = await this.read(projectId);
      const updated = updater(structuredClone(current));
      const comparable = (graph: CanvasGraphDocument) => JSON.stringify({ version: graph.version, nodes: graph.nodes, edges: graph.edges });
      if (comparable(updated) === comparable(current)) return current;
      return this.saveUnlocked(projectId, updated, current.revision ?? 0);
    });
  }

  private async saveUnlocked(projectId: string, graph: CanvasGraphDocument, expectedRevision?: number): Promise<CanvasGraphDocument> {
    const current = await this.readStored(projectId);
    const actual = current.revision ?? 0;
    if (expectedRevision !== undefined && expectedRevision !== actual) throw new CanvasRevisionConflict(expectedRevision, actual);
    const validated = canvasGraphSchema.parse({ ...graph, revision: actual + 1 });
    assertCanvasGraphAcyclic(validated);
    const path = this.path(projectId); await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    await rename(temporary, path);
    return this.materialize(projectId, validated);
  }

  private async readStored(projectId: string): Promise<CanvasGraphDocument> {
    try { return this.parse(JSON.parse(await readFile(this.path(projectId), "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (projectId !== this.options.defaultProjectId) return { version: 2, revision: 0, nodes: [], edges: inferCanvasEdges([]) };
      try { return this.parse(JSON.parse(await readFile(this.options.legacyPath, "utf8"))); }
      catch (legacyError) { if ((legacyError as NodeJS.ErrnoException).code === "ENOENT") return { version: 2, revision: 0, nodes: [], edges: inferCanvasEdges([]) }; throw legacyError; }
    }
  }

  private parse(value: unknown): CanvasGraphDocument {
    const graph = canvasGraphSchema.safeParse(value);
    if (graph.success) return { ...graph.data, revision: graph.data.revision ?? 0 };
    const legacy = canvasLayoutSchema.parse(value);
    return { version: 2, revision: 0, nodes: legacy, edges: inferCanvasEdges(legacy) };
  }

  private materialize(projectId: string, stored: CanvasGraphDocument): CanvasGraphDocument {
    const base = this.options.baseNodes(projectId);
    const storedById = new Map(stored.nodes.map((node) => [node.id, node]));
    const mergedBase = base.map((node) => { const saved = storedById.get(node.id); return saved ? { ...node, x: saved.x, y: saved.y, data: saved.data ?? node.data } : node; });
    const baseIds = new Set(base.map((node) => node.id));
    return { version: 2, revision: stored.revision ?? 0, nodes: [...mergedBase, ...stored.nodes.filter((node) => !baseIds.has(node.id))], edges: stored.edges };
  }

  private path(projectId: string): string { return resolve(this.options.root, `${createHash("sha256").update(projectId).digest("hex")}.json`); }
  private async serialize<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.writes.get(projectId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.writes.set(projectId, next);
    try { return await next; }
    finally { if (this.writes.get(projectId) === next) this.writes.delete(projectId); }
  }
}

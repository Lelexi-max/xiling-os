import type { FastifyInstance } from "fastify";
import { literatureQuerySchema, paperParamsSchema, paperSchema, projectIdQuerySchema, scopedPaperSchema, toPaperRecord } from "@xiling/api-contracts";
import type { PaperRecord } from "@xiling/contracts";
import type { EvidenceStore } from "@xiling/knowledge";
import { buildLiteratureGraph, createOceanHeatwaveFixture, type LiteratureSearchService } from "@xiling/literature";
import type { CanvasRepository } from "../canvas/canvas-repository.js";

export function registerLiteratureRoutes(app: FastifyInstance, dependencies: { literature: LiteratureSearchService; credentialsReady: Promise<unknown>; evidence: EvidenceStore; canvas: CanvasRepository }): void {
  app.get("/api/gate4/literature/demo", async () => { const fixture = createOceanHeatwaveFixture(); return buildLiteratureGraph(fixture.papers, fixture.seedIds, { fetchedAt: "2026-08-23T00:00:00.000Z" }); });
  app.get("/api/gate4/literature/search", async (request, reply) => {
    const parsed = literatureQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    await dependencies.credentialsReady;
    try { const result = await dependencies.literature.search(parsed.data.q, parsed.data.limit); const graph = result.papers.length ? buildLiteratureGraph(result.papers, [result.papers[0]!.id], { limit: parsed.data.limit, fetchedAt: result.fetchedAt }) : undefined; return { ...result, ...(graph ? { graph } : {}) }; }
    catch (error) { return reply.code(503).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
  app.get("/api/gate4/evidence", async (request, reply) => { const parsed = projectIdQuerySchema.safeParse(request.query); return parsed.success ? dependencies.evidence.listEvidence(parsed.data.projectId) : reply.code(400).send({ error: parsed.error.issues }); });
  app.post("/api/gate4/evidence", async (request, reply) => {
    const scoped = scopedPaperSchema.safeParse(request.body);
    if (scoped.success) return reply.code(201).send(dependencies.evidence.saveEvidence(scoped.data.projectId, toPaperRecord(scoped.data.paper)));
    const legacy = paperSchema.safeParse(request.body);
    return legacy.success ? reply.code(201).send(dependencies.evidence.saveEvidence("ocean-heatwave", toPaperRecord(legacy.data))) : reply.code(400).send({ error: scoped.error.issues });
  });
  app.post("/api/gate4/evidence/:paperId", async (request, reply) => {
    const params = paperParamsSchema.safeParse(request.params); const query = projectIdQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: "invalid evidence request" });
    const paper = createOceanHeatwaveFixture().papers.find((item) => item.id === params.data.paperId);
    return paper ? reply.code(201).send(dependencies.evidence.saveEvidence(query.data.projectId, paper)) : reply.code(404).send({ error: "Paper not found" });
  });
  const pin = async (projectId: string, paper: PaperRecord) => {
    let existing = false; let output: unknown;
    await dependencies.canvas.update(projectId, (graph) => {
      const id = `paper-${paper.id}`; const found = graph.nodes.find((item) => item.id === id);
      if (found) { existing = true; output = found; return graph; }
      const node = { id, x: 760 + (graph.nodes.length % 2) * 320, y: 90 + Math.floor(graph.nodes.length / 2) * 230, data: { eyebrow: "EVIDENCE PAPER", title: paper.title, body: `${paper.authors.join(" · ")} · ${paper.year} · cited ${paper.citationCount}`, tone: "paper" as const, source: { kind: "paper" as const, paperId: paper.id }, createdAt: new Date().toISOString() } };
      output = node; return { ...graph, nodes: [...graph.nodes, node], edges: [...graph.edges, { id: `edge-literature-${id}`, source: "literature", target: id, kind: "quote" as const }] };
    });
    return { existing, node: output };
  };
  app.post("/api/gate4/canvas/papers/:paperId", async (request, reply) => {
    const params = paperParamsSchema.safeParse(request.params); const query = projectIdQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: "invalid canvas paper request" });
    const paper = createOceanHeatwaveFixture().papers.find((item) => item.id === params.data.paperId); if (!paper) return reply.code(404).send({ error: "Paper not found" });
    const result = await pin(query.data.projectId, paper); return result.existing ? { status: "already-pinned", node: result.node } : reply.code(201).send({ status: "pinned", node: result.node });
  });
  app.post("/api/gate4/canvas/papers", async (request, reply) => {
    const scoped = scopedPaperSchema.safeParse(request.body); const legacy = paperSchema.safeParse(request.body);
    if (!scoped.success && !legacy.success) return reply.code(400).send({ error: scoped.error.issues });
    const projectId = scoped.success ? scoped.data.projectId : "ocean-heatwave"; const paper = toPaperRecord(scoped.success ? scoped.data.paper : legacy.data!);
    const result = await pin(projectId, paper); return result.existing ? { status: "already-pinned", node: result.node } : reply.code(201).send({ status: "pinned", node: result.node });
  });
}

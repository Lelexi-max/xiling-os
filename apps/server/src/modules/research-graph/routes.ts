import type { FastifyInstance } from "fastify";
import type { ResearchGraphStore } from "@xiling/research-graph";
import { researchGraphArtifactParamsSchema, researchGraphProjectParamsSchema, researchGraphProjectionQuerySchema, scientificCanvasLayoutSchema } from "@xiling/api-contracts";
import type { ScientificCanvasLayoutStore } from "./layout-store.js";
import { ScientificCanvasLayoutConflictError } from "./layout-store.js";

export function registerResearchGraphRoutes(app: FastifyInstance, dependencies: {
  graph: ResearchGraphStore;
  layout: ScientificCanvasLayoutStore;
  ready: Promise<unknown>;
  reconcile(): Promise<unknown>;
  projectExists(projectId: string): boolean;
}): void {
  app.get("/api/research-graph/health", async () => {
    await dependencies.ready;
    return dependencies.graph.initialize();
  });

  app.get("/api/projects/:projectId/research-graph", async (request, reply) => {
    const params = researchGraphProjectParamsSchema.safeParse(request.params);
    const query = researchGraphProjectionQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: "Invalid Research Graph request" });
    if (!dependencies.projectExists(params.data.projectId)) return reply.code(404).send({ error: "Project not found" });
    await dependencies.ready;
    await dependencies.reconcile();
    return dependencies.graph.getProjection(params.data.projectId, query.data.view);
  });

  app.get("/api/projects/:projectId/research-graph/layout", async (request, reply) => {
    const params = researchGraphProjectParamsSchema.safeParse(request.params);
    const query = researchGraphProjectionQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: "Invalid Scientific Canvas layout request" });
    if (!dependencies.projectExists(params.data.projectId)) return reply.code(404).send({ error: "Project not found" });
    return dependencies.layout.get(params.data.projectId, query.data.view);
  });

  app.put("/api/projects/:projectId/research-graph/layout", async (request, reply) => {
    const params = researchGraphProjectParamsSchema.safeParse(request.params);
    const query = researchGraphProjectionQuerySchema.safeParse(request.query);
    const body = scientificCanvasLayoutSchema.safeParse(request.body);
    if (!params.success || !query.success || !body.success) return reply.code(400).send({ error: "Invalid Scientific Canvas layout payload" });
    if (!dependencies.projectExists(params.data.projectId)) return reply.code(404).send({ error: "Project not found" });
    await dependencies.ready;
    await dependencies.reconcile();
    const projection = await dependencies.graph.getProjection(params.data.projectId, query.data.view);
    const visibleIds = new Set(projection.nodes.map((node) => node.id));
    if (body.data.positions.some((position) => !visibleIds.has(position.entityId))) return reply.code(400).send({ error: "Layout contains an entity outside the selected Research Graph projection" });
    try {
      return dependencies.layout.save({ projectId: params.data.projectId, view: query.data.view, revision: body.data.revision, positions: body.data.positions, ...(body.data.viewport ? { viewport: body.data.viewport } : {}) });
    } catch (error) {
      if (error instanceof ScientificCanvasLayoutConflictError) return reply.code(409).send({ error: error.message, currentRevision: error.actualRevision });
      throw error;
    }
  });

  app.get("/api/projects/:projectId/research-graph/artifacts/:artifactVersionId/lineage", async (request, reply) => {
    const params = researchGraphArtifactParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid artifact lineage request" });
    if (!dependencies.projectExists(params.data.projectId)) return reply.code(404).send({ error: "Project not found" });
    await dependencies.ready;
    await dependencies.reconcile();
    const lineage = await dependencies.graph.traceArtifact(params.data.projectId, params.data.artifactVersionId);
    return lineage ?? reply.code(404).send({ error: "Artifact version not found" });
  });
}

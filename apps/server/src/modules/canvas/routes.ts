import type { FastifyInstance } from "fastify";
import { canvasGraphSchema, canvasLayoutPayloadSchema, projectIdQuerySchema } from "@xiling/api-contracts";
import { CanvasRevisionConflict, inferCanvasEdges, type CanvasRepository } from "./canvas-repository.js";

export function registerCanvasRoutes(app: FastifyInstance, repository: CanvasRepository): void {
  app.get("/api/canvas/demo", async () => repository.read("ocean-heatwave"));
  app.get("/api/gate4/canvas/layout", async (request, reply) => {
    const parsed = projectIdQuerySchema.safeParse(request.query);
    return parsed.success ? repository.read(parsed.data.projectId) : reply.code(400).send({ error: parsed.error.issues });
  });
  app.post("/api/gate4/canvas/layout", async (request, reply) => {
    const parsed = canvasLayoutPayloadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const projectId = Array.isArray(parsed.data) ? "ocean-heatwave" : parsed.data.projectId;
    const layout = Array.isArray(parsed.data) ? parsed.data : parsed.data.nodes;
    const edges = Array.isArray(parsed.data) || !parsed.data.edges ? inferCanvasEdges(layout) : parsed.data.edges;
    try {
      const saved = await repository.save(projectId, canvasGraphSchema.parse({ version: 2, nodes: layout, edges }), Array.isArray(parsed.data) ? undefined : parsed.data.revision);
      return Array.isArray(parsed.data) ? { status: "saved", revision: saved.revision, nodes: layout.length, edges: edges.length } : { status: "saved", revision: saved.revision, projectId, nodes: layout.length, edges: edges.length };
    } catch (error) {
      if (error instanceof CanvasRevisionConflict) return reply.code(409).send({ error: "canvas_revision_conflict", expectedRevision: error.expected, actualRevision: error.actual });
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

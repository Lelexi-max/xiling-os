import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { z } from "zod";
import type { Gate3ResearchService } from "@xiling/research";

/** Compatibility-only route module. New research flows must use ProjectWorkflowService. */
export function registerLegacyGate3Routes(app: FastifyInstance, dependencies: { research: Gate3ResearchService; ready: Promise<unknown>; runsRoot: string }): void {
  let activeRun: AbortController | undefined;
  app.get("/api/gate3/snapshot", async () => { await dependencies.ready; return dependencies.research.getSnapshot(); });
  app.post("/api/gate3/plan", async () => { await dependencies.ready; return dependencies.research.plan(); });
  app.post("/api/gate3/approvals/:approvalId/approve", async (request, reply) => {
    await dependencies.ready;
    const parsed = z.object({ approvalId: z.string().min(1) }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    try { return await dependencies.research.approve(parsed.data.approvalId); }
    catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
  app.post("/api/gate3/run", async (_request, reply) => {
    await dependencies.ready;
    if (activeRun) return reply.code(409).send({ error: "Another research run is already active" });
    const controller = new AbortController(); activeRun = controller;
    try { return await dependencies.research.run(controller.signal); }
    catch (error) { const message = error instanceof Error ? error.message : String(error); return reply.code(message.includes("approval") ? 403 : 409).send({ error: message }); }
    finally { activeRun = undefined; }
  });
  app.post("/api/gate3/run/cancel", async (_request, reply) => {
    if (!activeRun) return reply.code(409).send({ error: "No research run is active" });
    activeRun.abort(); return { status: "cancelling" };
  });
  app.get("/api/gate3/artifacts/:runId/*", async (request, reply) => {
    const parsed = z.object({ runId: z.string().uuid(), "*": z.string().min(1) }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid artifact path" });
    const relative = parsed.data["*"];
    if (relative.includes("\\") || relative.split("/").includes("..")) return reply.code(400).send({ error: "Invalid artifact path" });
    const artifactRoot = resolve(dependencies.runsRoot, parsed.data.runId, "artifacts"); const artifactPath = resolve(artifactRoot, relative);
    if (!artifactPath.startsWith(`${artifactRoot}${sep}`)) return reply.code(400).send({ error: "Invalid artifact path" });
    try { const contentTypes: Record<string, string> = { png: "image/png", csv: "text/csv; charset=utf-8", json: "application/json; charset=utf-8", nc: "application/x-netcdf" }; const extension = relative.split(".").at(-1)?.toLowerCase() ?? ""; return reply.type(contentTypes[extension] ?? "application/octet-stream").send(await readFile(artifactPath)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return reply.code(404).send({ error: "Artifact not found" }); throw error; }
  });
}

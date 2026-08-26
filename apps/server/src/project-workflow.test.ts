import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConnectorWorkflowService, FixtureConnectorAdapter, JsonConnectorJobRepository, preflightConnector } from "@xiling/connectors";
import type { OceanSubsetRequest } from "@xiling/contracts";
import { FixtureProjectAnalysisRunner, JsonProjectWorkflowRepository, ProjectWorkflowService, SqliteProjectWorkflowRepository } from "./project-workflow.js";

const request: OceanSubsetRequest = { connectorId: "argo-gdac", datasetId: "argo-fixture", variables: ["TEMP", "PSAL", "PRES"], region: { west: 140, east: 150, south: 30, north: 40 }, depth: { min: 0, max: 200 }, time: { start: "2023-01-01", end: "2023-02-01" }, outputFormat: "NetCDF" };

describe("project research workflow", () => {
  it("persists workflow snapshots and projection outbox records atomically in SQLite", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-workflow-sqlite-"));
    const path = join(root, "workflows.sqlite");
    const repository = new SqliteProjectWorkflowRepository(path);
    const workflow = {
      id: "workflow-outbox",
      projectId: "project-outbox",
      sessionId: "session-outbox",
      sourceCallId: "call-outbox",
      requestHash: "hash",
      request,
      preflight: preflightConnector(request),
      status: "draft" as const,
      createdAt: "2026-08-26T00:00:00.000Z",
      updatedAt: "2026-08-26T00:00:00.000Z",
    };
    await repository.save([workflow]);
    await expect(repository.load()).resolves.toMatchObject([{ id: workflow.id, status: "draft" }]);
    const event = repository.listProjectionOutbox()[0]!;
    expect(event).toMatchObject({ sourceId: workflow.id, workflow: { projectId: workflow.projectId } });
    expect(repository.markProjectionOutboxApplied([event.projectionKey])).toBe(1);
    repository.close();

    const reopened = new SqliteProjectWorkflowRepository(path);
    expect(reopened.listProjectionOutbox()).toHaveLength(0);
    await expect(reopened.load()).resolves.toHaveLength(1);
    reopened.close();
  });
  it("deduplicates a recovered Agent projection and rejects key collisions", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-project-workflow-idempotency-"));
    const connector = new FixtureConnectorAdapter(join(root, "connector-artifacts"));
    const downloads = new ConnectorWorkflowService(new JsonConnectorJobRepository(join(root, "connector-jobs.json")), connector); await downloads.initialize();
    const service = new ProjectWorkflowService(new JsonProjectWorkflowRepository(join(root, "workflows.json")), downloads, connector, new FixtureProjectAnalysisRunner(join(root, "project-runs")), () => true);
    await service.initialize();
    const provenance = { projectId: "p", sessionId: "s", sourceRunId: "r", sourceProjectionKey: "projection-key", sourceEventSequence: 7, sourceRequestHash: "source-hash" };
    const first = await service.create({ ...provenance, sourceCallId: "call-before-restart", request });
    const recovered = await service.create({ ...provenance, sourceEventSequence: 11, sourceCallId: "call-after-restart", request });
    expect(recovered.id).toBe(first.id);
    expect(service.list()).toHaveLength(1);
    await expect(service.create({ ...provenance, sourceCallId: "collision", request: { ...request, datasetId: "different" } })).rejects.toThrow("idempotency conflict");
  });

  it("persists the approval-gated fixture loop through review and RO-Crate", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-project-workflow-"));
    const connector = new FixtureConnectorAdapter(join(root, "connector-artifacts"), () => "2026-08-24T00:00:00.000Z");
    const downloads = new ConnectorWorkflowService(new JsonConnectorJobRepository(join(root, "connector-jobs.json")), connector, () => "2026-08-24T00:00:00.000Z");
    await downloads.initialize();
    const service = new ProjectWorkflowService(new JsonProjectWorkflowRepository(join(root, "workflows.json")), downloads, connector, new FixtureProjectAnalysisRunner(join(root, "project-runs"), () => "2026-08-24T00:00:00.000Z"), () => true, () => "2026-08-24T00:00:00.000Z");
    await service.initialize();
    const draft = await service.create({ projectId: "project-1", sessionId: "session-1", sourceCallId: "call-1", request });
    await expect(service.run(draft.id)).rejects.toThrow("explicit approval");
    expect((await service.probe(draft.id)).status).toBe("pending_approval");
    expect((await service.approve(draft.id)).status).toBe("approved");
    const completed = await service.run(draft.id);
    expect(completed).toMatchObject({ status: "completed", run: { status: "succeeded" }, review: { verdict: "rejected" } });
    expect(completed.run?.artifactUris).toContain(`artifact://workflow/${draft.id}/ro-crate/ro-crate-metadata.json`);
    expect((await service.markSettled(draft.id)).settledAt).toBeTruthy();
  });

  it("cancels an active analysis and allows an explicit reset", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-project-workflow-cancel-"));
    const connector = new FixtureConnectorAdapter(join(root, "connector-artifacts"));
    const downloads = new ConnectorWorkflowService(new JsonConnectorJobRepository(join(root, "connector-jobs.json")), connector); await downloads.initialize();
    let started!: () => void; const analysisStarted = new Promise<void>((resolve) => { started = resolve; });
    const service = new ProjectWorkflowService(new JsonProjectWorkflowRepository(join(root, "workflows.json")), downloads, connector, { execute: async (_workflow, signal) => { started(); return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })); } }, () => true);
    await service.initialize(); const draft = await service.create({ projectId: "p", sessionId: "s", sourceCallId: "c", request }); await service.probe(draft.id); await service.approve(draft.id);
    const running = service.run(draft.id); await analysisStarted; expect(service.cancel(draft.id)).toEqual({ status: "cancelling" }); await expect(running).rejects.toThrow("cancelled");
    expect(service.get(draft.id)?.status).toBe("cancelled"); expect((await service.reset(draft.id)).status).toBe("draft");
  });
});

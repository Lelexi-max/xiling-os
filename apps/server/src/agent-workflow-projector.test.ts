import { describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteAgentSessionStore } from "@xiling/agent-harness";
import type { OceanSubsetRequest, ProjectResearchWorkflow } from "@xiling/domain-ocean";
import { projectAgentWorkflowDraft, reconcileAgentWorkflowDrafts } from "./agent-workflow-projector.js";

const request: OceanSubsetRequest = { connectorId: "erddap", datasetId: "sst", variables: ["sst"], region: { west: 110, east: 120, south: 10, north: 20 }, time: { start: "2024-01-01", end: "2024-01-02" }, outputFormat: "NetCDF" };
const workflow = { id: "workflow-00000000-0000-0000-0000-000000000001", projectId: "project-1", sessionId: "session-1", sourceCallId: "call-1", sourceRunId: "run-1", requestHash: "plan-hash", request, preflight: { estimatedBytes: 1, disclosures: [] }, status: "draft", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" } as unknown as ProjectResearchWorkflow;
const base = { projectId: "project-1", sessionId: "session-1", runId: "run-1", sourceEventSequence: 7, sourceOperationId: "operation-1", ready: Promise.resolve() };

describe("server-owned Agent workflow projection", () => {
  it("creates only an approval-gated draft with stable projection provenance", async () => {
    const create = vi.fn(async () => workflow);
    const event = await projectAgentWorkflowDraft({ ...base, event: { type: "tool.finished", toolName: "plan_ocean_data_subset", callId: "call-1", details: { kind: "ocean-data-plan", request } }, workflows: { create } });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ sourceRunId: "run-1", sourceCallId: "call-1", sourceEventSequence: 7, sourceOperationId: "operation-1", request }));
    expect(event).toMatchObject({ type: "workflow.projected", workflowId: workflow.id, workflowStatus: "draft", approvalRequired: true, sourceEventSequence: 7 });
  });

  it("deduplicates recovery call-id changes with a request-stable projection key", async () => {
    const create = vi.fn(async () => workflow);
    const first = await projectAgentWorkflowDraft({ ...base, event: { type: "tool.finished", toolName: "plan_ocean_data_subset", callId: "call-1", details: { kind: "ocean-data-plan", request } }, workflows: { create } });
    const resumed = await projectAgentWorkflowDraft({ ...base, sourceEventSequence: 11, event: { type: "tool.finished", toolName: "plan_ocean_data_subset", callId: "call-after-resume", details: { kind: "ocean-data-plan", request } }, workflows: { create } });
    expect(first?.type === "workflow.projected" ? first.projectionKey : undefined).toBe(resumed?.type === "workflow.projected" ? resumed.projectionKey : undefined);
  });

  it("ignores unrelated tools and emits a separate retryable projection failure", async () => {
    const create = vi.fn(async () => { throw new Error("disk full"); });
    await expect(projectAgentWorkflowDraft({ ...base, event: { type: "tool.finished", toolName: "read_project_context", callId: "call-2" }, workflows: { create } })).resolves.toBeUndefined();
    const failed = await projectAgentWorkflowDraft({ ...base, event: { type: "tool.finished", toolName: "plan_ocean_data_subset", callId: "call-1", details: { kind: "ocean-data-plan", request } }, workflows: { create } });
    expect(failed).toMatchObject({ type: "workflow.projection.failed", retryable: true });
  });

  it("records invalid planning results as permanent projection failures", async () => {
    const create = vi.fn(async () => workflow);
    const failed = await projectAgentWorkflowDraft({ ...base, event: { type: "tool.finished", toolName: "plan_ocean_data_subset", callId: "call-1", details: { kind: "ocean-data-plan", request: { connectorId: "unknown" } } }, workflows: { create } });
    expect(create).not.toHaveBeenCalled();
    expect(failed).toMatchObject({ type: "workflow.projection.failed", retryable: false });
  });

  it("reconciles a durable tool result once after a crash window", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-workflow-reconcile-"));
    const store = new SqliteAgentSessionStore(join(root, "agent.sqlite"));
    store.createSession({ id: "session-1", projectId: "project-1" });
    const run = store.startRun({ sessionId: "session-1", prompt: "plan", clientCommandId: "command-1" }).run;
    store.transitionRun(run.id, "running");
    store.appendEvent(run.sessionId, run.id, "tool.finished", { type: "tool.finished", toolName: "plan_ocean_data_subset", callId: "call-1", details: { kind: "ocean-data-plan", request } });
    const create = vi.fn(async () => workflow);
    expect(await reconcileAgentWorkflowDrafts({ store, ready: Promise.resolve(), workflows: { create } })).toMatchObject({ projected: 1 });
    expect(await reconcileAgentWorkflowDrafts({ store, ready: Promise.resolve(), workflows: { create } })).toMatchObject({ projected: 0 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(store.listEvents(run.id).map((event) => event.type)).toEqual(["tool.finished", "workflow.projected"]);
    store.close();
  });
});

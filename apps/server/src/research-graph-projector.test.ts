import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteAgentSessionStore } from "@xiling/agent-harness";
import { preflightConnector } from "@xiling/connectors";
import type { OceanSubsetRequest, ProjectResearchWorkflow } from "@xiling/domain-ocean";
import { KnowledgeService } from "@xiling/knowledge";
import { LadybugResearchGraphStore } from "@xiling/research-graph";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteProjectWorkflowRepository } from "./project-workflow.js";
import { knowledgeRecordToChangeSet, ResearchGraphReconciler, workflowRecordToChangeSet } from "./research-graph-projector.js";

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

const request: OceanSubsetRequest = {
  connectorId: "argo-gdac",
  datasetId: "argo-fixture",
  variables: ["TEMP", "PSAL"],
  region: { west: 140, east: 150, south: 30, north: 40 },
  depth: { min: 0, max: 200 },
  time: { start: "2023-01-01", end: "2023-02-01" },
  outputFormat: "NetCDF",
};

function completedWorkflow(projectId: string): ProjectResearchWorkflow {
  return {
    id: "workflow-rg2",
    projectId,
    sessionId: "session-rg2",
    sourceCallId: "call-rg2",
    sourceRunId: "agent-run-rg2",
    requestHash: "request-hash",
    approvedRequestHash: "request-hash",
    request,
    preflight: preflightConnector(request),
    status: "completed",
    datasetArtifact: { uri: "artifact://workflow/workflow-rg2/dataset.nc", bytes: 128, sha256: "a".repeat(64) },
    run: { id: "run-rg2", projectId, planId: "workflow-rg2", status: "succeeded", artifactUris: ["artifact://workflow/workflow-rg2/figure.png"], startedAt: "2026-08-26T00:01:00.000Z", finishedAt: "2026-08-26T00:02:00.000Z" },
    review: { id: "review-rg2", runId: "run-rg2", verdict: "accepted", checks: [{ id: "hash", passed: true, detail: "verified" }], limitations: [], createdAt: "2026-08-26T00:03:00.000Z" },
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:03:00.000Z",
  };
}

describe("Research Graph projection chain", () => {
  it("maps a completed workflow to plan, data, run, artifacts, reviewer and Agent provenance", () => {
    const project = { id: "p", name: "海洋项目", description: "fixture", researchQuestion: "层结是否变化？", domainIds: ["ocean-climate"], status: "active" as const, createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T00:00:00.000Z" };
    const workflow = completedWorkflow(project.id);
    const changeSet = workflowRecordToChangeSet({ id: "event", projectionKey: "workflow:event", projectId: project.id, sourceId: workflow.id, eventType: "workflow.snapshot.updated", workflow, createdAt: workflow.updatedAt }, project);
    expect(changeSet.nodes.map((node) => node.kind)).toEqual(expect.arrayContaining(["Project", "ResearchQuestion", "ResearchPlan", "Dataset", "DatasetSnapshot", "Approval", "Actor", "ResearchRun", "Artifact", "ArtifactVersion", "ReviewReport", "LifecycleEvent"]));
    expect(changeSet.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "USED", sourceId: "run-rg2", targetId: `dataset-snapshot:${"a".repeat(64)}` }),
      expect.objectContaining({ kind: "EVALUATES", sourceId: "review-rg2", targetId: "run-rg2" }),
      expect.objectContaining({ kind: "ASSOCIATED_WITH", sourceId: "run-rg2", targetId: "actor:agent-run:agent-run-rg2" }),
      expect.objectContaining({ kind: "TRANSITIONED_BY", sourceId: expect.stringMatching(/^artifact-version:/), targetId: expect.stringMatching(/^lifecycle:artifact:/) }),
    ]));
  });

  it("recovers the target-committed/source-unacknowledged crash window without duplicates", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-rg2-reconcile-"));
    cleanup.push(root);
    const knowledge = new KnowledgeService(join(root, "knowledge.sqlite"));
    const workflows = new SqliteProjectWorkflowRepository(join(root, "workflows.sqlite"));
    const agents = new SqliteAgentSessionStore(join(root, "agent.sqlite"));
    const graph = new LadybugResearchGraphStore(join(root, "research-graph.lbdb"));
    const project = knowledge.createProject({ name: "重放项目", description: "crash fixture", researchQuestion: "重复投影是否幂等？", domainIds: ["general-science"] });
    const event = knowledge.listProjectionOutbox().find((candidate) => candidate.projectId === project.id)!;

    await graph.applyProjection({ projectionKey: event.projectionKey, source: "knowledge", sourceId: event.sourceId, changeSet: knowledgeRecordToChangeSet(event, project) });
    expect(knowledge.listProjectionOutbox().some((candidate) => candidate.projectionKey === event.projectionKey)).toBe(true);

    const reconciler = new ResearchGraphReconciler(graph, knowledge, workflows, agents);
    await expect(reconciler.reconcile()).resolves.toMatchObject({ knowledge: expect.any(Number) });
    expect(knowledge.listProjectionOutbox().some((candidate) => candidate.projectionKey === event.projectionKey)).toBe(false);
    const projection = await graph.getProjection(project.id);
    expect(projection.nodes.filter((node) => node.id === project.id)).toHaveLength(1);

    await graph.close();
    workflows.close();
    agents.close();
    knowledge.close();
  });
});

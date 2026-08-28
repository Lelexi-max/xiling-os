import { createHash } from "node:crypto";
import { connectorRequestSchema, toOceanSubsetRequest } from "@xiling/api-contracts";
import type { SqliteAgentSessionStore } from "@xiling/agent-harness";
import type { AgentStreamEvent } from "@xiling/contracts";
import type { OceanSubsetRequest, ProjectResearchWorkflow } from "@xiling/domain-ocean";

export const WORKFLOW_DRAFT_PROJECTOR = "ocean-workflow-draft-v1" as const;
type WorkflowProjectionEvent = Extract<AgentStreamEvent, { type: "workflow.projected" | "workflow.projection.failed" }>;

export interface WorkflowDraftWriter {
  create(input: {
    projectId: string;
    sessionId: string;
    sourceRunId: string;
    sourceCallId: string;
    sourceProjectionKey: string;
    sourceEventSequence: number;
    sourceOperationId?: string;
    sourceRequestHash: string;
    request: OceanSubsetRequest;
  }): Promise<ProjectResearchWorkflow>;
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Projects an already-persisted planning result into an approval-gated draft.
 * It never probes, approves, downloads, or executes the draft. */
export async function projectAgentWorkflowDraft(input: {
  event: AgentStreamEvent;
  projectId: string;
  sessionId: string;
  runId: string;
  sourceEventSequence: number;
  sourceOperationId?: string;
  ready: Promise<unknown>;
  workflows: WorkflowDraftWriter;
}): Promise<WorkflowProjectionEvent | undefined> {
  const { event } = input;
  if (event.type !== "tool.finished" || event.toolName !== "plan_ocean_data_subset") return undefined;
  const details = event.details as { kind?: unknown; request?: unknown } | undefined;
  const parsed = details?.kind === "ocean-data-plan" ? connectorRequestSchema.safeParse(details.request) : undefined;
  if (!parsed?.success) {
    return {
      type: "workflow.projection.failed",
      projector: WORKFLOW_DRAFT_PROJECTOR,
      projectionKey: `invalid:${input.runId}:${input.sourceEventSequence}`,
      projectId: input.projectId,
      sessionId: input.sessionId,
      runId: input.runId,
      sourceCallId: event.callId,
      sourceEventSequence: input.sourceEventSequence,
      ...(input.sourceOperationId ? { sourceOperationId: input.sourceOperationId } : {}),
      retryable: false,
      message: "Planning tool result does not match the ocean subset contract",
    };
  }

  const request = toOceanSubsetRequest(parsed.data);
  const requestHash = hash(request);
  const projectionKey = hash([WORKFLOW_DRAFT_PROJECTOR, input.projectId, input.sessionId, input.runId, requestHash]);
  try {
    await input.ready;
    const workflow = await input.workflows.create({
      projectId: input.projectId,
      sessionId: input.sessionId,
      sourceRunId: input.runId,
      sourceCallId: event.callId,
      sourceProjectionKey: projectionKey,
      sourceEventSequence: input.sourceEventSequence,
      ...(input.sourceOperationId ? { sourceOperationId: input.sourceOperationId } : {}),
      sourceRequestHash: requestHash,
      request,
    });
    return {
      type: "workflow.projected",
      projector: WORKFLOW_DRAFT_PROJECTOR,
      projectionKey,
      workflowId: workflow.id,
      projectId: input.projectId,
      sessionId: input.sessionId,
      runId: input.runId,
      sourceCallId: event.callId,
      sourceEventSequence: input.sourceEventSequence,
      ...(input.sourceOperationId ? { sourceOperationId: input.sourceOperationId } : {}),
      requestHash: workflow.requestHash ?? requestHash,
      workflowStatus: "draft",
      approvalRequired: true,
    };
  } catch {
    return {
      type: "workflow.projection.failed",
      projector: WORKFLOW_DRAFT_PROJECTOR,
      projectionKey,
      projectId: input.projectId,
      sessionId: input.sessionId,
      runId: input.runId,
      sourceCallId: event.callId,
      sourceEventSequence: input.sourceEventSequence,
      ...(input.sourceOperationId ? { sourceOperationId: input.sourceOperationId } : {}),
      retryable: true,
      message: "Workflow draft projection failed",
    };
  }
}

/** Replays durable tool results that have no successful (or permanent-failure)
 * projection event. The stable projection key closes both crash windows. */
export async function reconcileAgentWorkflowDrafts(input: {
  store: SqliteAgentSessionStore;
  ready: Promise<unknown>;
  workflows: WorkflowDraftWriter;
}): Promise<{ scanned: number; projected: number }> {
  await input.ready;
  const projectionRecords = input.store.listEventsByType(["workflow.projected", "workflow.projection.failed"]);
  const terminalKeys = new Set(
    projectionRecords.flatMap((record) => {
        const event = record.payload as AgentStreamEvent;
        if (event.type === "workflow.projected" || (event.type === "workflow.projection.failed" && !event.retryable)) return [event.projectionKey];
        return [];
      }),
  );
  const terminalSources = new Set(
    projectionRecords.flatMap((record) => {
      const event = record.payload as AgentStreamEvent;
      if (event.type === "workflow.projected" || (event.type === "workflow.projection.failed" && !event.retryable)) return [`${event.runId}:${event.sourceEventSequence}`];
      return [];
    }),
  );
  const sourceEvents = input.store.listEventsByType(["tool.finished"]);
  let projected = 0;
  for (const source of sourceEvents) {
    const event = source.payload as AgentStreamEvent;
    if (event.type !== "tool.finished" || event.toolName !== "plan_ocean_data_subset") continue;
    if (terminalSources.has(`${source.runId}:${source.sequence}`)) continue;
    const run = input.store.getRun(source.runId);
    const session = run ? input.store.getSession(run.sessionId) : undefined;
    if (!run || !session) continue;
    const operation = input.store.snapshot(run.id).operations.find((item) => item.callId === event.callId);
    const projection = await projectAgentWorkflowDraft({
      event,
      projectId: session.projectId,
      sessionId: session.id,
      runId: run.id,
      sourceEventSequence: source.sequence,
      ...(operation ? { sourceOperationId: operation.id } : {}),
      ready: input.ready,
      workflows: input.workflows,
    });
    if (!projection || terminalKeys.has(projection.projectionKey)) continue;
    input.store.appendEvent(source.sessionId, source.runId, projection.type, projection);
    if (projection.type === "workflow.projected") projected += 1;
    if (projection.type === "workflow.projected" || !projection.retryable) {
      terminalKeys.add(projection.projectionKey);
      terminalSources.add(`${source.runId}:${source.sequence}`);
    }
  }
  return { scanned: sourceEvents.length, projected };
}

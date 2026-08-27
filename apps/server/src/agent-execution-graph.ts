import type { AgentOperationRecord, AgentRunSnapshot, AgentSessionEntry, AgentSessionRecord, SqliteAgentSessionStore } from "@xiling/agent-harness";
import type { AgentExecutionEdge, AgentExecutionGraphProjection, AgentExecutionNode, AgentExecutionNodeStatus, AgentExecutionGraphScope } from "@xiling/contracts";

export interface AgentExecutionGraphOptions {
  projectId: string;
  scope: AgentExecutionGraphScope;
  sessionId?: string;
  sessionTitle?: (sessionId: string) => string | undefined;
  maxSessions?: number;
  maxRuns?: number;
  maxOperations?: number;
  maxEntries?: number;
}

const compactText = (value: string, max = 150): string => {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
};
const durationMs = (start: string, finish?: string): number | undefined => {
  if (!finish) return undefined;
  const value = Date.parse(finish) - Date.parse(start);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
};
const nodeId = (kind: string, id: string) => `${kind}:${id}`;
const edge = (kind: AgentExecutionEdge["kind"], source: string, target: string, label?: string): AgentExecutionEdge => ({
  id: `${kind}:${source}:${target}`,
  source,
  target,
  kind,
  ...(label ? { label } : {}),
});

function operationNode(projectId: string, session: AgentSessionRecord, run: AgentRunSnapshot["run"], operation: AgentOperationRecord): AgentExecutionNode {
  const kind = operation.kind === "tool" ? "tool" : "model";
  const elapsed = durationMs(operation.startedAt, operation.finishedAt);
  return {
    id: nodeId("operation", operation.id),
    projectId,
    kind,
    title: operation.kind === "tool" ? operation.name : operation.kind === "model" ? "Pi 模型推理" : operation.name,
    summary: operation.error ? compactText(operation.error) : operation.kind === "tool" ? `工具调用 · ${operation.name}` : compactText(run.prompt),
    status: operation.status,
    timestamp: operation.startedAt,
    source: { sessionId: session.id, runId: run.id, operationId: operation.id },
    metrics: { ...(elapsed !== undefined ? { durationMs: elapsed } : {}) },
  };
}

function entryNode(projectId: string, entry: AgentSessionEntry): AgentExecutionNode {
  const metadata = entry.metadata as { toolName?: unknown; failed?: unknown } | undefined;
  const toolName = typeof metadata?.toolName === "string" ? metadata.toolName : undefined;
  const title = entry.kind === "user" ? "研究指令"
    : entry.kind === "assistant" ? "Agent 回答"
      : entry.kind === "compaction" ? "上下文压缩"
        : toolName ? `${toolName} · 返回` : "工具返回";
  return {
    id: nodeId("entry", entry.id),
    projectId,
    kind: entry.kind === "compaction" ? "compaction" : "message",
    title,
    summary: compactText(entry.text),
    ...(metadata?.failed === true ? { status: "failed" as const } : {}),
    timestamp: entry.createdAt,
    source: { sessionId: entry.sessionId, runId: entry.runId, entryId: entry.id },
  };
}

/**
 * Builds a bounded, read-only semantic projection from the Agent journal.
 * Tool-call entries are represented by their durable Operation node; their
 * paired tool-result entry remains visible and linked to that Operation.
 */
export function projectAgentExecutionGraph(store: SqliteAgentSessionStore, options: AgentExecutionGraphOptions): AgentExecutionGraphProjection {
  const maxSessions = options.maxSessions ?? 24;
  const maxRuns = options.maxRuns ?? 80;
  const maxOperations = options.maxOperations ?? 160;
  const maxEntries = options.maxEntries ?? 160;
  const projectDelegations = store.listProjectDelegations(options.projectId);
  const baseCandidates = options.scope === "session"
    ? (options.sessionId ? [store.getSession(options.sessionId)].filter((item): item is AgentSessionRecord => Boolean(item && item.projectId === options.projectId)) : [])
    : store.listProjectSessions(options.projectId);
  const baseRunIds = new Set(baseCandidates.flatMap((session) => store.listSessionRuns(session.id).map((run) => run.id)));
  const childSessionIds = new Set(projectDelegations.filter((item) => baseRunIds.has(item.parentRunId) || baseRunIds.has(item.rootRunId)).map((item) => item.childSessionId));
  const candidates = [...baseCandidates, ...[...childSessionIds].map((id) => store.getSession(id)).filter((item): item is AgentSessionRecord => Boolean(item))]
    .filter((session, index, all) => all.findIndex((candidate) => candidate.id === session.id) === index);
  const sessions = candidates.slice(0, maxSessions);
  const allRuns = sessions.flatMap((session) => store.listSessionRuns(session.id).map((run) => ({ session, run })))
    .sort((left, right) => Date.parse(right.run.startedAt) - Date.parse(left.run.startedAt));
  const selectedRuns = allRuns.slice(0, maxRuns).sort((left, right) => Date.parse(left.run.startedAt) - Date.parse(right.run.startedAt));
  const nodes: AgentExecutionNode[] = [];
  const edges: AgentExecutionEdge[] = [];
  let operationCount = 0;
  let entryCount = 0;
  let operationTruncated = false;
  let entryTruncated = false;

  if (options.scope === "project") {
    nodes.push({
      id: nodeId("project", options.projectId), projectId: options.projectId, kind: "project", title: "项目 Agent 运行", summary: "项目内全部耐久 Agent 会话与执行链", status: "active", timestamp: sessions[0]?.updatedAt ?? new Date().toISOString(), source: {},
    });
  }
  const selectedSessionIds = new Set(selectedRuns.map(({ session }) => session.id));
  const renderedSessions = sessions.filter((session) => allRuns.length <= maxRuns || selectedSessionIds.has(session.id));
  for (const session of renderedSessions) {
    const sessionGraphId = nodeId("session", session.id);
    nodes.push({
      id: sessionGraphId,
      projectId: options.projectId,
      kind: "session",
      title: options.sessionTitle?.(session.id) ?? `对话 ${session.id.slice(0, 8)}`,
      summary: session.status === "archived" ? "已归档的 Agent 会话" : "耐久 Agent 会话",
      status: session.status,
      timestamp: session.updatedAt,
      source: { sessionId: session.id },
    });
    if (options.scope === "project") edges.push(edge("contains", nodeId("project", options.projectId), sessionGraphId, "会话"));
  }

  const previousRunBySession = new Map<string, string>();
  for (const { session, run } of selectedRuns) {
    const snapshot = store.snapshot(run.id);
    const runGraphId = nodeId("run", run.id);
    const usage = snapshot.usageTotals;
    const elapsed = durationMs(run.startedAt, run.finishedAt);
    nodes.push({
      id: runGraphId,
      projectId: options.projectId,
      kind: "run",
      title: compactText(run.prompt, 64) || "Agent Run",
      summary: run.error ? compactText(run.error) : `${snapshot.operations.length} 个操作 · ${snapshot.entries.length} 条记录`,
      status: run.status as AgentExecutionNodeStatus,
      timestamp: run.startedAt,
      source: { sessionId: session.id, runId: run.id },
      metrics: { totalTokens: usage.totalTokens, cost: usage.cost, ...(elapsed !== undefined ? { durationMs: elapsed } : {}) },
    });
    edges.push(edge("contains", nodeId("session", session.id), runGraphId, "运行"));
    const previous = previousRunBySession.get(session.id);
    if (previous) edges.push(edge("continued", previous, runGraphId, "下一轮"));
    previousRunBySession.set(session.id, runGraphId);

    const operations = snapshot.operations.slice(0, Math.max(0, maxOperations - operationCount));
    operationCount += operations.length;
    if (operations.length < snapshot.operations.length) operationTruncated = true;
    const modelOperation = operations.find((operation) => operation.kind === "model");
    const operationById = new Map(operations.map((operation) => [operation.id, operation]));
    for (const operation of operations) {
      const graphId = nodeId("operation", operation.id);
      nodes.push(operationNode(options.projectId, session, run, operation));
      edges.push(edge(operation.kind === "tool" && modelOperation ? "invoked" : "started", operation.kind === "tool" && modelOperation ? nodeId("operation", modelOperation.id) : runGraphId, graphId, operation.kind === "tool" ? "调用" : "推理"));
    }

    const visibleEntries = snapshot.entries.filter((entry) => entry.kind !== "tool-call").slice(0, Math.max(0, maxEntries - entryCount));
    entryCount += visibleEntries.length;
    if (visibleEntries.length < snapshot.entries.filter((entry) => entry.kind !== "tool-call").length) entryTruncated = true;
    for (const entry of visibleEntries) {
      const graphId = nodeId("entry", entry.id);
      nodes.push(entryNode(options.projectId, entry));
      const metadata = entry.metadata as { operationId?: unknown } | undefined;
      const linkedOperation = typeof metadata?.operationId === "string" ? operationById.get(metadata.operationId) : undefined;
      if (entry.kind === "tool-result" && linkedOperation) edges.push(edge("returned", nodeId("operation", linkedOperation.id), graphId, "返回"));
      else if (entry.kind === "assistant" && modelOperation) edges.push(edge("produced", nodeId("operation", modelOperation.id), graphId, "回答"));
      else if (entry.kind === "compaction") edges.push(edge("compacted", runGraphId, graphId, "压缩"));
      else edges.push(edge(entry.kind === "user" ? "started" : "produced", runGraphId, graphId, entry.kind === "user" ? "指令" : "记录"));
    }
  }

  const selectedRunIds = new Set(selectedRuns.map(({ run }) => run.id));
  const visibleDelegations = projectDelegations.filter((item) => selectedRunIds.has(item.parentRunId) && (!item.childRunId || selectedRunIds.has(item.childRunId)));
  for (const delegation of visibleDelegations) {
    const delegationGraphId = nodeId("delegation", delegation.id);
    nodes.push({
      id: delegationGraphId,
      projectId: options.projectId,
      kind: "delegation",
      title: delegation.roleId,
      summary: compactText(delegation.objective),
      status: delegation.status,
      timestamp: delegation.createdAt,
      source: { runId: delegation.parentRunId, delegationId: delegation.id },
      parentRunId: delegation.parentRunId,
      childRunId: delegation.childRunId,
      childSessionId: delegation.childSessionId,
      roleId: delegation.roleId,
      isolation: delegation.isolation,
    });
    edges.push(edge("delegated", nodeId("run", delegation.parentRunId), delegationGraphId, "委派"));
    if (delegation.childRunId) edges.push(edge("started", delegationGraphId, nodeId("run", delegation.childRunId), "子任务"));
  }

  return {
    projectId: options.projectId,
    scope: options.scope,
    ...(options.scope === "session" && options.sessionId ? { sessionId: options.sessionId } : {}),
    nodes,
    edges,
    generatedAt: new Date().toISOString(),
    truncated: candidates.length > sessions.length || allRuns.length > selectedRuns.length || operationTruncated || entryTruncated,
    counts: { sessions: renderedSessions.length, runs: selectedRuns.length, ...(visibleDelegations.length ? { delegations: visibleDelegations.length } : {}), operations: operationCount, entries: entryCount },
  };
}

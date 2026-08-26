import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteAgentSessionStore } from "@xiling/agent-harness";
import { projectAgentExecutionGraph } from "./agent-execution-graph.js";

async function fixtureStore() {
  const root = await mkdtemp(join(tmpdir(), "xiling-agent-graph-"));
  const store = new SqliteAgentSessionStore(join(root, "agent.sqlite"));
  const session = store.createSession({ id: "session-ocean", projectId: "ocean-project" });
  store.createSession({ id: "session-other", projectId: "other-project" });
  const run = store.startRun({ sessionId: session.id, clientCommandId: "command-1", prompt: "检查 Argo 温盐剖面" }).run;
  store.transitionRun(run.id, "running");
  store.appendEntry(session.id, run.id, { kind: "user", role: "user", text: run.prompt });
  const model = store.appendOperation(run.id, { kind: "model", status: "running", name: "pi.prompt" });
  const tool = store.appendOperation(run.id, { kind: "tool", status: "running", name: "inspect_ocean_dataset", callId: "call-1" });
  store.appendEntry(session.id, run.id, { kind: "tool-call", role: "tool", text: tool.name, metadata: { operationId: tool.id, callId: "call-1" } });
  store.finishOperation(tool.id, "completed", { result: { profiles: 3 } });
  store.appendEntry(session.id, run.id, { kind: "tool-result", role: "tool", text: "3 profiles", metadata: { operationId: tool.id, callId: "call-1", toolName: tool.name } });
  store.appendEntry(session.id, run.id, { kind: "assistant", role: "assistant", text: "发现三个可用剖面。" });
  store.finishOperation(model.id, "completed");
  store.appendUsage(session.id, run.id, { operationId: model.id, providerId: "fixture", modelId: "fixture", inputTokens: 40, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 60, cost: 0 });
  store.transitionRun(run.id, "completed");
  return { store, session, run, model, tool };
}

describe("Agent Execution Graph projector", () => {
  it("projects durable operations and entries without crossing project boundaries", async () => {
    const { store, session, run, model, tool } = await fixtureStore();
    try {
      const graph = projectAgentExecutionGraph(store, { projectId: "ocean-project", scope: "project", sessionTitle: () => "Argo 检查" });
      expect(graph.counts).toEqual({ sessions: 1, runs: 1, operations: 2, entries: 3 });
      expect(graph.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
        "project:ocean-project",
        `session:${session.id}`,
        `run:${run.id}`,
        `operation:${model.id}`,
        `operation:${tool.id}`,
      ]));
      expect(graph.nodes.some((node) => node.source.sessionId === "session-other")).toBe(false);
      expect(graph.nodes.find((node) => node.id === `run:${run.id}`)?.metrics).toMatchObject({ totalTokens: 60 });
      expect(graph.edges).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "invoked", source: `operation:${model.id}`, target: `operation:${tool.id}` }),
        expect.objectContaining({ kind: "returned", source: `operation:${tool.id}` }),
        expect.objectContaining({ kind: "produced", source: `operation:${model.id}` }),
      ]));
      expect(graph.nodes.some((node) => node.title === "Argo 检查")).toBe(true);
    } finally { store.close(); }
  });

  it("supports a session-only bounded projection", async () => {
    const { store, session } = await fixtureStore();
    try {
      const graph = projectAgentExecutionGraph(store, { projectId: "ocean-project", scope: "session", sessionId: session.id, maxOperations: 1, maxEntries: 1 });
      expect(graph.scope).toBe("session");
      expect(graph.nodes.some((node) => node.kind === "project")).toBe(false);
      expect(graph.counts).toEqual({ sessions: 1, runs: 1, operations: 1, entries: 1 });
      expect(graph.truncated).toBe(true);
    } finally { store.close(); }
  });
});

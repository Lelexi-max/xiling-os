import { describe, expect, it } from "vitest";
import type { AgentExecutionGraphProjection, AgentExecutionNode } from "@xiling/contracts";
import { arrangeConversationCanvas, buildConversationCanvas } from "./AgentExecutionGraphView.js";

const raw = (item: Partial<AgentExecutionNode> & Pick<AgentExecutionNode, "id" | "kind" | "title">): AgentExecutionNode => ({
  projectId: "ocean-project",
  summary: "",
  timestamp: "2026-08-27T02:00:00.000Z",
  source: {},
  ...item,
});

const projection = (scope: "session" | "project"): AgentExecutionGraphProjection => ({
  projectId: "ocean-project",
  scope,
  ...(scope === "session" ? { sessionId: "session-1" } : {}),
  generatedAt: "2026-08-27T02:10:00.000Z",
  truncated: false,
  counts: { sessions: 1, runs: 1, operations: 2, entries: 3 },
  nodes: [
    raw({ id: "project:ocean-project", kind: "project", title: "项目", source: {} }),
    raw({ id: "session:session-1", kind: "session", title: "Argo 分析", source: { sessionId: "session-1" } }),
    raw({ id: "run:run-1", kind: "run", title: "比较 2023 年混合层深度异常", status: "completed", source: { sessionId: "session-1", runId: "run-1" }, metrics: { totalTokens: 240 } }),
    raw({ id: "operation:model", kind: "model", title: "Pi 模型推理", source: { sessionId: "session-1", runId: "run-1", operationId: "model" } }),
    raw({ id: "operation:tool", kind: "tool", title: "inspect_ocean_dataset", source: { sessionId: "session-1", runId: "run-1", operationId: "tool" } }),
    raw({ id: "entry:user", kind: "message", title: "研究指令", summary: "比较 2023 年混合层深度异常", source: { sessionId: "session-1", runId: "run-1", entryId: "user" } }),
    raw({ id: "entry:tool", kind: "message", title: "inspect_ocean_dataset · 返回", summary: "3 profiles", source: { sessionId: "session-1", runId: "run-1", entryId: "tool" } }),
    raw({ id: "entry:assistant", kind: "message", title: "Agent 回答", summary: "混合层较气候态偏浅。", source: { sessionId: "session-1", runId: "run-1", entryId: "assistant" } }),
  ],
  edges: [],
});

describe("Flow-style Agent conversation canvas", () => {
  it("folds execution internals into one prompt and one response node", () => {
    const canvas = buildConversationCanvas(projection("session"));
    expect(canvas.nodes.map((node) => node.data.displayKind)).toEqual(["prompt", "response"]);
    expect(canvas.nodes.some((node) => node.data.sourceNode.kind === "model" || node.data.sourceNode.kind === "tool")).toBe(false);
    expect(canvas.nodes.find((node) => node.data.displayKind === "response")?.data).toMatchObject({
      summary: "混合层较气候态偏浅。",
      hiddenDetailCount: 4,
      toolNames: ["inspect_ocean_dataset"],
    });
    expect(canvas.foldedDetails).toBe(4);
    expect(canvas.edges).toEqual([expect.objectContaining({ source: "prompt:run-1", target: "response:run-1", data: { kind: "answer" } })]);
  });

  it("adds only a lightweight conversation root in project scope", () => {
    const canvas = buildConversationCanvas(projection("project"));
    expect(canvas.nodes.map((node) => node.data.displayKind)).toEqual(["thread", "prompt", "response"]);
    expect(canvas.edges.some((edge) => edge.data?.kind === "thread" && edge.source === "thread:session-1")).toBe(true);
    const arranged = arrangeConversationCanvas(canvas.nodes, canvas.edges);
    const positions = new Map(arranged.map((node) => [node.data.displayKind, node.position.y]));
    expect(positions.get("thread")).toBeLessThan(positions.get("prompt")!);
    expect(positions.get("prompt")).toBeLessThan(positions.get("response")!);
  });

  it("shows each delegated child as one compact task between parent and child turns", () => {
    const graph = projection("session");
    graph.nodes.push(
      raw({ id: "session:child", kind: "session", title: "反方审稿", source: { sessionId: "child" } }),
      raw({ id: "run:child-run", kind: "run", title: "独立审查", status: "completed", source: { sessionId: "child", runId: "child-run" } }),
      raw({ id: "entry:child-answer", kind: "message", title: "Agent 回答", summary: "发现证据缺口。", source: { sessionId: "child", runId: "child-run", entryId: "child-answer" } }),
      raw({ id: "delegation:d1", kind: "delegation", title: "independent-reviewer", summary: "独立审查结论", status: "completed", source: { runId: "run-1", delegationId: "d1" }, parentRunId: "run-1", childRunId: "child-run", childSessionId: "child" }),
    );
    const canvas = buildConversationCanvas(graph);
    expect(canvas.nodes.filter((node) => node.data.displayKind === "agent-task")).toHaveLength(1);
    expect(canvas.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "response:run-1", target: "agent-task:d1", data: { kind: "delegation" } }),
      expect.objectContaining({ source: "agent-task:d1", target: "prompt:child-run", data: { kind: "delegation" } }),
    ]));
  });
});

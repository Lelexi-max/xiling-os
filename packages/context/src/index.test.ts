import { describe, expect, it } from "vitest";
import type { CanvasEdge, CanvasNode, ContextCapsule } from "@xiling/contracts";
import { ContextAssemblyCache, ContextCapacityError, assembleContext, createNodeContextCapsule, normalizeContextHistory, projectContext, projectResearchGraphContext } from "./index.js";

const now = "2026-08-23T00:00:00.000Z";
const node = (id: string, parentId?: string): CanvasNode => ({
  id,
  projectId: "p1",
  kind: "response",
  title: id,
  summary: id,
  ...(parentId ? { parentId } : {}),
  createdAt: now,
});

describe("projectContext", () => {
  it("projects only a bounded local neighbourhood from a cyclic Research Graph", () => {
    const graph = {
      projectId: "p1", view: "all" as const, generatedAt: now,
      nodes: ["question", "claim", "paper", "fragment", "artifact", "unrelated"].map((id, index) => ({ id, projectId: "p1", kind: index === 0 ? "ResearchQuestion" as const : "Claim" as const, title: id, summary: id, revision: 1, contentHash: id, properties: {}, createdAt: now, updatedAt: now })),
      relations: [
        ["question", "claim", "CONTAINS"], ["claim", "paper", "BASED_ON"], ["paper", "fragment", "HAS_FRAGMENT"], ["fragment", "claim", "ASSERTS"], ["claim", "artifact", "EVALUATES"],
      ].map(([sourceId, targetId, kind], index) => ({ id: `r${index}`, projectId: "p1", kind: kind as "CONTAINS", sourceId: sourceId!, targetId: targetId!, properties: {}, createdAt: now, updatedAt: now })),
    };
    const projection = projectResearchGraphContext({ activeNodeId: "claim", quotedNodeIds: ["unrelated"] }, graph, new Map(), [], { maxNeighbourNodes: 2, maxDepth: 2 });
    expect(projection.activeBranchNodeIds.at(-1)).toBe("claim");
    expect(projection.activeBranchNodeIds).toHaveLength(3);
    expect(projection.quotedNodeIds).toEqual(["unrelated"]);
    expect(projection.explanation[0]).toContain("局部邻域 2 个");
  });
  it("loads only the active ancestry and explicit cross-branch quotes", () => {
    const nodes = new Map([
      ["root", node("root")],
      ["a", node("a", "root")],
      ["b", node("b", "root")],
      ["a2", node("a2", "a")],
    ]);
    const capsules = new Map<string, ContextCapsule>([
      ["root", { id: "c-root", sourceNodeId: "root", sourceRevision: "1", summary: "root", claims: [], artifactUris: [] }],
    ]);

    const result = projectContext(
      { activeNodeId: "a2", quotedNodeIds: ["b", "b"], capabilityQuery: "分析 NetCDF 温度" },
      { nodes, capsules },
      [
        { id: "artifact.search", description: "search", keywords: ["查找"] },
        { id: "runner.xarray", description: "xarray", keywords: ["netcdf", "温度"] },
      ],
    );

    expect(result.activeBranchNodeIds).toEqual(["root", "a", "a2"]);
    expect(result.quotedNodeIds).toEqual(["b"]);
    expect(result.activeBranchNodeIds).not.toContain("b");
    expect(result.activatedCapabilities).toEqual(["runner.xarray"]);
    expect(result.projectionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.economy.selectedNodeCount).toBe(4);
  });

  it("rejects parent cycles instead of leaking arbitrary canvas context", () => {
    const nodes = new Map([
      ["a", node("a", "b")],
      ["b", node("b", "a")],
    ]);
    expect(() => projectContext({ activeNodeId: "a", quotedNodeIds: [] }, { nodes, capsules: new Map() })).toThrow(
      "cycle",
    );
  });

  it("projects a persisted DAG while keeping quote edges out of active ancestry", () => {
    const nodes = new Map([["root", node("root")], ["branch", node("branch")], ["answer", node("answer")], ["paper", node("paper")]]);
    const edges: CanvasEdge[] = [
      { id: "e1", source: "root", target: "branch", kind: "follow-up" },
      { id: "e2", source: "branch", target: "answer", kind: "checkpoint" },
      { id: "e3", source: "paper", target: "answer", kind: "quote" },
    ];
    const result = projectContext({ activeNodeId: "answer", quotedNodeIds: ["paper", "paper"] }, { nodes, capsules: new Map(), edges });
    expect(result.activeBranchNodeIds).toEqual(["root", "branch", "answer"]);
    expect(result.quotedNodeIds).toEqual(["paper"]);
    expect(result.economy.selectedNodeCount).toBe(4);
  });

  it("rejects cycles in persisted graph edges", () => {
    const nodes = new Map([["a", node("a")], ["b", node("b")]]);
    const edges: CanvasEdge[] = [
      { id: "e1", source: "a", target: "b", kind: "follow-up" },
      { id: "e2", source: "b", target: "a", kind: "follow-up" },
    ];
    expect(() => projectContext({ activeNodeId: "a", quotedNodeIds: [] }, { nodes, capsules: new Map(), edges })).toThrow("cycle");
  });

  it("builds revisioned capsules from complete node content", () => {
    const first = createNodeContextCapsule({ projectId: "p1", nodeId: "n1", title: "结论", body: "第一段背景。观测结果显示混合层变浅。最后仍需复核。", artifactUris: ["artifact://plot"] });
    const same = createNodeContextCapsule({ projectId: "p1", nodeId: "n1", title: "结论", body: "第一段背景。观测结果显示混合层变浅。最后仍需复核。", artifactUris: ["artifact://plot"] });
    const changed = createNodeContextCapsule({ projectId: "p1", nodeId: "n1", title: "结论", body: "第一段背景。观测结果显示混合层加深。最后仍需复核。", artifactUris: ["artifact://plot"] });
    expect(first.sourceRevision).toBe(same.sourceRevision);
    expect(first.sourceRevision).not.toBe(changed.sourceRevision);
    expect(first.claims).toContain("观测结果显示混合层变浅。");
  });

  it("normalizes stored messages into complete turns before the current prompt", () => {
    const normalized = normalizeContextHistory([
      { id: "a0", role: "assistant", text: "孤立回答", timestamp: 0 },
      { id: "u1", role: "user", text: "问题一", timestamp: 1 },
      { id: "u2", role: "user", text: "问题二", timestamp: 2 },
      { id: "a1", role: "assistant", text: "合并后的回答", timestamp: 3 },
      { id: "u3", role: "user", text: "尚未回答", timestamp: 4 },
    ]);
    expect(normalized.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(normalized[0]?.text).toBe("问题一\n\n问题二");
  });

  it("keeps recent and quoted nodes exact while representing older ancestry with capsules", () => {
    const capsules = ["root", "old", "recent"].map((id) => createNodeContextCapsule({ projectId: "p1", nodeId: id, title: id, body: `${id} 的完整正文。`, artifactUris: [] }));
    const projection = projectContext(
      { activeNodeId: "recent", quotedNodeIds: ["quote"], activatedCapabilityIds: ["project.read"] },
      {
        nodes: new Map([["root", node("root")], ["old", node("old", "root")], ["recent", node("recent", "old")], ["quote", node("quote")]]),
        capsules: new Map(capsules.map((capsule) => [capsule.sourceNodeId, capsule])),
      },
    );
    const result = assembleContext({
      projection,
      nodes: new Map(["root", "old", "recent", "quote"].map((id) => [id, { id, title: id, body: `${id} 的完整正文。` }])),
      history: [{ id: "h1", role: "user", text: "较早问题", timestamp: 1 }],
      modelContextWindow: 16_000,
      maxOutputTokens: 2_000,
      fixedPromptTokens: 500,
      toolSchemaTokens: 200,
      skillTokens: 100,
      activatedSkillNames: [],
    });
    expect(result.trace.capsuleNodeIds).toEqual(["root"]);
    expect(result.trace.exactNodeIds).toEqual(expect.arrayContaining(["old", "recent", "quote"]));
    expect(result.canvasText).toContain("显式引用原文");
    expect(result.history).toHaveLength(0);
    expect(result.trace.omittedHistoryCount).toBe(1);
  });

  it("fails explicitly when selected evidence cannot fit the model window", () => {
    const capsule = createNodeContextCapsule({ projectId: "p1", nodeId: "root", title: "root", body: "证据".repeat(4_000), artifactUris: [] });
    const projection = projectContext({ activeNodeId: "root", quotedNodeIds: [] }, { nodes: new Map([["root", node("root")]]), capsules: new Map([["root", capsule]]) });
    expect(() => assembleContext({ projection, nodes: new Map([["root", { id: "root", title: "root", body: "证据".repeat(4_000) }]]), history: [], modelContextWindow: 4_096, maxOutputTokens: 1_024, fixedPromptTokens: 500, toolSchemaTokens: 200, skillTokens: 0, activatedSkillNames: [] })).toThrow(ContextCapacityError);
  });

  it("fails when fixed prompts and the current question alone exceed capacity", () => {
    const projection = projectContext({ activeNodeId: "root", quotedNodeIds: [] }, { nodes: new Map([["root", node("root")]]), capsules: new Map() });
    expect(() => assembleContext({ projection, nodes: new Map([["root", { id: "root", title: "root", body: "短证据" }]]), history: [], modelContextWindow: 4_096, maxOutputTokens: 1_024, fixedPromptTokens: 1_100, toolSchemaTokens: 0, skillTokens: 0, activatedSkillNames: [] })).toThrow(ContextCapacityError);
  });

  it("selects newest history as contiguous turns without jumping over a large middle turn", () => {
    const projection = projectContext({ activeNodeId: "root", quotedNodeIds: [] }, { nodes: new Map([["root", node("root")]]), capsules: new Map() });
    const history = [
      { id: "old-u", role: "user" as const, text: "较早问题", timestamp: 1 },
      { id: "old-a", role: "assistant" as const, text: "较早回答", timestamp: 2 },
      { id: "large-u", role: "user" as const, text: "大型问题", timestamp: 3 },
      { id: "large-a", role: "assistant" as const, text: "中间回答".repeat(1_200), timestamp: 4 },
      { id: "new-u", role: "user" as const, text: "最近问题", timestamp: 5 },
      { id: "new-a", role: "assistant" as const, text: "最近回答", timestamp: 6 },
    ];
    const result = assembleContext({ projection, nodes: new Map([["root", { id: "root", title: "root", body: "短证据" }]]), history, modelContextWindow: 4_096, maxOutputTokens: 1_024, fixedPromptTokens: 200, toolSchemaTokens: 0, skillTokens: 0, activatedSkillNames: [] });
    expect(result.history.map((message) => message.id)).toEqual(["new-u", "new-a"]);
    expect(result.trace.omittedHistoryCount).toBe(4);
  });

  it("reuses deterministic assembly results through the host cache", () => {
    const cache = new ContextAssemblyCache(2);
    const key = cache.key({ projection: "a", history: [] });
    const value = { canvasText: "fixture", history: [], trace: { projectionHash: "a", includedNodeIds: [], exactNodeIds: [], capsuleNodeIds: [], omittedHistoryCount: 0, activatedCapabilityIds: [], activatedSkillNames: [], estimatedInputTokens: 1, availableInputTokens: 10, cache: "miss" as const, degradations: [] } };
    cache.set(key, value);
    expect(cache.get(key)).toEqual(value);
  });

  it("bounds cache memory by estimated tokens as well as entry count", () => {
    const cache = new ContextAssemblyCache(10, 3);
    const value = (projectionHash: string, estimatedInputTokens: number) => ({ canvasText: projectionHash, history: [], trace: { projectionHash, includedNodeIds: [], exactNodeIds: [], capsuleNodeIds: [], omittedHistoryCount: 0, activatedCapabilityIds: [], activatedSkillNames: [], estimatedInputTokens, availableInputTokens: 10, cache: "miss" as const, degradations: [] } });
    cache.set("a", value("a", 2));
    cache.set("b", value("b", 2));
    expect(cache.get("a")).toBeUndefined();
    expect(cache.stats()).toEqual({ entries: 1, estimatedTokens: 2 });
    cache.set("too-large", value("too-large", 4));
    expect(cache.get("too-large")).toBeUndefined();
  });
});

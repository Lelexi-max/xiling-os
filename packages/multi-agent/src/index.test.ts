import { describe, expect, it } from "vitest";
import { AgentRoleRegistry, MultiAgentOrchestrator, evaluateDelegationNeed, extractTaskResultText, type DelegationStore, type StoredDelegation } from "./index.js";

class MemoryStore implements DelegationStore {
  records = new Map<string, StoredDelegation>();
  getDelegation(id: string) { return this.records.get(id); }
  createDelegation(input: Omit<StoredDelegation, "createdAt" | "status"> & { status?: StoredDelegation["status"] }): StoredDelegation {
    const record = { ...input, status: input.status ?? "queued", createdAt: new Date().toISOString() };
    this.records.set(record.id, record); return record;
  }
  updateDelegation(id: string, input: { status: StoredDelegation["status"]; childRunId?: string; result?: unknown; error?: string }): StoredDelegation {
    const existing = this.records.get(id)!;
    const updated = { ...existing, ...input };
    this.records.set(id, updated); return updated;
  }
}

describe("multi-agent research orchestration", () => {
  it("uses isolated child sessions, bounded concurrency and durable results", async () => {
    const store = new MemoryStore();
    let sessions = 0; let active = 0; let peak = 0;
    const orchestrator = new MultiAgentOrchestrator(store, {
      createChildSession: () => `child-${++sessions}`,
      async execute(input) {
        input.onRunStarted(`run-${input.childSessionId}`);
        active += 1; peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 4));
        active -= 1;
        return { status: "completed", ...extractTaskResultText(`完成 ${input.objective}\n来源：https://example.test/${input.role.id}\n局限：离线 fixture`) };
      },
    }, new AgentRoleRegistry(), { maxConcurrency: 2 });
    const results = await orchestrator.delegate({
      projectId: "ocean", parentRunId: "parent", mode: "parallel",
      contextManifest: { projectId: "ocean", projectBriefRevision: "v1", researchEntityIds: ["question"], sourceUris: [], projectionHash: "hash" },
      tasks: [
        { roleId: "literature-scout", objective: "track-a" },
        { roleId: "skeptical-reviewer", objective: "track-b" },
        { roleId: "evidence-curator", objective: "track-c" },
      ],
    });
    expect(peak).toBe(2);
    expect(new Set(results.map((result) => result.childSessionId)).size).toBe(3);
    expect(results.every((result) => result.status === "completed")).toBe(true);
    expect([...store.records.values()].every((record) => record.status === "completed" && record.contextManifestHash.length === 64)).toBe(true);
  });

  it("rejects recursion and only recommends delegation with a bounded contract", () => {
    const registry = new AgentRoleRegistry();
    expect(() => registry.register({ id: "recursive", title: "bad", description: "bad", systemPrompt: "bad", allowedCapabilities: [], defaultIsolation: "scoped", canDelegate: true as never })).toThrow("recursion");
    expect(evaluateDelegationNeed({ independentTracks: 3, hasOutputContract: true }).delegate).toBe(true);
    expect(evaluateDelegationNeed({ independentTracks: 3, hasOutputContract: false }).delegate).toBe(false);
    expect(evaluateDelegationNeed({ requiresBlindReview: true, unresolvedApproval: true }).delegate).toBe(false);
  });

  it("reuses a completed deterministic delegation instead of duplicating work", async () => {
    const store = new MemoryStore();
    let sessions = 0;
    let executions = 0;
    const orchestrator = new MultiAgentOrchestrator(store, {
      createChildSession: () => `child-${++sessions}`,
      async execute(input) {
        executions += 1;
        input.onRunStarted("child-run");
        return { status: "completed", ...extractTaskResultText("已核验 artifact://result") };
      },
    });
    const request = {
      projectId: "ocean", parentRunId: "parent", mode: "single" as const,
      contextManifest: { projectId: "ocean", projectBriefRevision: "v1", researchEntityIds: [], sourceUris: [], projectionHash: "projection" },
      tasks: [{ roleId: "reproducibility-auditor", objective: "核验复现包" }],
    };
    const first = await orchestrator.delegate(request);
    const retried = await orchestrator.delegate(request);
    expect(retried).toEqual(first);
    expect(sessions).toBe(1);
    expect(executions).toBe(1);
  });

  it("persists cancellation when a parent abort reaches the child executor", async () => {
    const store = new MemoryStore();
    const controller = new AbortController();
    const orchestrator = new MultiAgentOrchestrator(store, {
      createChildSession: () => "child-cancelled",
      async execute(input) {
        input.onRunStarted("child-run-cancelled");
        return await new Promise((_, reject) => {
          input.signal?.addEventListener("abort", () => reject(new Error("child aborted")), { once: true });
          controller.abort();
        });
      },
    });
    const [result] = await orchestrator.delegate({
      projectId: "ocean", parentRunId: "parent-cancel", mode: "single", signal: controller.signal,
      contextManifest: { projectId: "ocean", projectBriefRevision: "v1", researchEntityIds: [], sourceUris: [], projectionHash: "projection" },
      tasks: [{ roleId: "literature-scout", objective: "取消检索" }],
    });
    expect(result?.status).toBe("cancelled");
    expect([...store.records.values()][0]?.status).toBe("cancelled");
  });
});

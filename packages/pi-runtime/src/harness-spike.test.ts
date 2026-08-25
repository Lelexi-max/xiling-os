import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import {
  AgentHarness,
  HarnessNotImplemented,
  JsonlSessionRepo,
  prepareCompaction,
  shouldCompact,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { describe, expect, it } from "vitest";

const fixtureModel: Model<"openai-responses"> = {
  id: "gate-4.5-a-fixture",
  name: "Gate 4.5-A fixture",
  api: "openai-responses",
  provider: "xiling-offline",
  baseUrl: "https://invalid.local",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 4_096,
  maxTokens: 512,
};

function assistantMessage(text: string, timestamp: number): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "xiling-offline",
    model: fixtureModel.id,
    usage: {
      input: 200,
      output: 50,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 250,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp,
  };
}

describe("Gate 4.5-A Pi harness spike", () => {
  it("persists Pi session entries in JSONL and restores the active branch", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-gate-45-session-"));
    const env = new NodeExecutionEnv({ cwd: root });
    const repo = new JsonlSessionRepo({ fs: env, sessionsRoot: join(root, "sessions") });

    try {
      const session = await repo.create({
        id: "gate-45-durable-session",
        cwd: root,
        metadata: { projectId: "project-fixture" },
      });
      const userEntryId = await session.appendMessage({
        role: "user",
        content: "比较两段固定海温序列。",
        timestamp: 1,
      });
      const assistantEntryId = await session.appendMessage(assistantMessage("已记录比较方案。", 2));

      const [metadata] = await repo.list({ cwd: root });
      expect(metadata).toMatchObject({ id: "gate-45-durable-session", metadata: { projectId: "project-fixture" } });

      const restored = await repo.open(metadata!);
      const branch = await restored.findEntriesOnBranch({ order: "oldestFirst" });
      expect(branch.map((entry) => entry.id)).toEqual([userEntryId, assistantEntryId]);
      expect(branch[0]).toMatchObject({ type: "message", message: { role: "user", content: "比较两段固定海温序列。" } });
      expect(await restored.getLeafId()).toBe(assistantEntryId);
    } finally {
      await env.cleanup();
    }
  });

  it("proves 0.84.2 exposes a shell AgentHarness whose run operations are unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-gate-45-harness-"));
    const env = new NodeExecutionEnv({ cwd: root });
    const repo = new JsonlSessionRepo({ fs: env, sessionsRoot: join(root, "sessions") });

    try {
      const session = await repo.create({ id: "gate-45-harness-shell", cwd: root });
      const { harness, suspended } = await AgentHarness.create({
        session,
        models: createModels(),
        model: fixtureModel,
        drive: "manual",
      });

      expect(suspended).toEqual([]);
      await expect(harness.prompt("offline fixture")).rejects.toMatchObject({
        name: "HarnessNotImplemented",
        operation: "prompt",
      } satisfies Partial<HarnessNotImplemented>);
      await harness.close();
    } finally {
      await env.cleanup();
    }
  });

  it("prepares deterministic transcript compaction without calling a model", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-gate-45-compaction-"));
    const env = new NodeExecutionEnv({ cwd: root });
    const repo = new JsonlSessionRepo({ fs: env, sessionsRoot: join(root, "sessions") });

    try {
      const session = await repo.create({ id: "gate-45-compaction", cwd: root });
      for (let turn = 0; turn < 6; turn += 1) {
        const repeatedContext = `turn-${turn} ` + "fixed-ocean-context ".repeat(80);
        await session.appendMessage({ role: "user", content: repeatedContext, timestamp: turn * 2 + 1 });
        await session.appendMessage(assistantMessage(`answer-${turn} ` + "analysis ".repeat(60), turn * 2 + 2));
      }

      const entries = await session.findEntriesOnBranch({ order: "oldestFirst" });
      const settings = { enabled: true, reserveTokens: 512, keepRecentTokens: 300 };
      const prepared = prepareCompaction(entries, settings);

      expect(prepared.ok).toBe(true);
      if (!prepared.ok || !prepared.value) throw new Error("Expected compaction preparation");
      expect(prepared.value.messagesToSummarize.length).toBeGreaterThan(0);
      expect(prepared.value.retainedTail.length).toBeGreaterThan(0);
      expect(prepared.value.messagesToSummarize.length + prepared.value.turnPrefixMessages.length + prepared.value.retainedTail.length).toBe(entries.length);
      expect(shouldCompact(prepared.value.tokensBefore, 1_024, settings)).toBe(false);
      expect(shouldCompact(prepared.value.tokensBefore, 700, settings)).toBe(true);
    } finally {
      await env.cleanup();
    }
  });
});

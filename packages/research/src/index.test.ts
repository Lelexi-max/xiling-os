import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ResearchRunner } from "./index.js";
import { Gate3ResearchService, JsonProjectRepository } from "./index.js";

const runner: ResearchRunner = {
  async execute() {
    return {
      artifactUris: ["artifact://argo-map", "artifact://argo-profile", "artifact://gate3-ro-crate"],
      checks: [
        { id: "qc", passed: true, detail: "仅使用 QC=1 剖面" },
        { id: "finite", passed: true, detail: "MLD 与热含量均为有限值" },
      ],
    };
  },
};

async function service() {
  const root = await mkdtemp(join(tmpdir(), "xiling-gate3-"));
  const repository = new JsonProjectRepository(join(root, "project.json"));
  const research = new Gate3ResearchService(repository, runner, { now: () => "2026-08-23T00:00:00.000Z" });
  await research.initialize();
  return { research, repository };
}

describe("Gate3ResearchService", () => {
  it("rejects execution before explicit approval", async () => {
    const { research } = await service();
    await research.plan();
    await expect(research.run()).rejects.toThrow("explicit approval");
  });

  it("persists an approved, reviewed, canvas/wiki-linked research run", async () => {
    const { research, repository } = await service();
    await research.plan();
    await research.approve("approval-argo-gate3");
    const result = await research.run();
    expect(result.run?.status).toBe("succeeded");
    expect(result.review?.verdict).toBe("accepted");
    expect(result.canvasNodes.at(-1)?.kind).toBe("artifact");
    expect(result.wikiRevisions).toHaveLength(1);
    expect((await repository.load())?.run?.status).toBe("succeeded");
  });

  it("serializes runs and resets all derived state when replacing the plan", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const root = await mkdtemp(join(tmpdir(), "xiling-gate3-lock-"));
    const research = new Gate3ResearchService(new JsonProjectRepository(join(root, "project.json")), {
      async execute(plan) {
        await pending;
        return runner.execute(plan);
      },
    });
    await research.initialize();
    await research.plan();
    await research.approve("approval-argo-gate3");
    const first = research.run();
    await expect(research.run()).rejects.toThrow("already active");
    await expect(research.plan()).rejects.toThrow("while a run is active");
    release();
    await first;
    const reset = await research.plan();
    expect(reset.run).toBeUndefined();
    expect(reset.review).toBeUndefined();
    expect(reset.canvasEdges).toEqual([]);
    expect(reset.wikiRevisions).toEqual([]);
  });

  it("marks an interrupted persisted run as failed on restart", async () => {
    const { research, repository } = await service();
    const planned = await research.plan();
    await repository.save({
      ...planned,
      run: { id: "run-interrupted", projectId: planned.projectId, planId: planned.plan!.id, status: "running", artifactUris: [], startedAt: planned.updatedAt },
    });
    const recovered = new Gate3ResearchService(repository, runner, { now: () => "2026-08-23T01:00:00.000Z" });
    const snapshot = await recovered.initialize();
    expect(snapshot.run).toMatchObject({ id: "run-interrupted", status: "failed", finishedAt: "2026-08-23T01:00:00.000Z" });
  });
});

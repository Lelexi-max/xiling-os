import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CanvasRevisionConflict, FileCanvasRepository } from "./canvas-repository.js";

describe("FileCanvasRepository", () => {
  it("increments revisions and rejects stale writers", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-canvas-repository-"));
    const repository = new FileCanvasRepository({ root, legacyPath: join(root, "legacy.json"), defaultProjectId: "p", baseNodes: () => [] });
    const first = await repository.read("p");
    expect(first.revision).toBe(0);
    const saved = await repository.save("p", { version: 2, nodes: [], edges: [] }, 0);
    expect(saved.revision).toBe(1);
    await expect(repository.save("p", { version: 2, nodes: [], edges: [] }, 0)).rejects.toBeInstanceOf(CanvasRevisionConflict);
  });

  it("serializes atomic update operations", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-canvas-update-"));
    const repository = new FileCanvasRepository({ root, legacyPath: join(root, "legacy.json"), defaultProjectId: "p", baseNodes: () => [] });
    await Promise.all(["a", "b"].map((id) => repository.update("p", (graph) => ({ ...graph, nodes: [...graph.nodes, { id, x: 0, y: 0 }] }))));
    expect((await repository.read("p")).nodes.map((node) => node.id).sort()).toEqual(["a", "b"]);
  });

  it("does not create a revision for an idempotent update", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-canvas-idempotent-"));
    const repository = new FileCanvasRepository({ root, legacyPath: join(root, "legacy.json"), defaultProjectId: "p", baseNodes: () => [] });
    const before = await repository.read("p");
    const after = await repository.update("p", (graph) => graph);
    expect(after.revision).toBe(before.revision);
  });
});

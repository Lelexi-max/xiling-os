import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ScientificCanvasLayoutConflictError, ScientificCanvasLayoutStore } from "./layout-store.js";

describe("ScientificCanvasLayoutStore", () => {
  it("persists project and view scoped presentation state", () => {
    const path = join(mkdtempSync(join(tmpdir(), "xiling-layout-")), "layout.sqlite");
    const store = new ScientificCanvasLayoutStore(path);
    expect(store.get("p1", "all")).toEqual({ projectId: "p1", view: "all", revision: 0, positions: [] });
    const saved = store.save({ projectId: "p1", view: "all", revision: 0, positions: [{ entityId: "claim:1", x: 120, y: 240 }], viewport: { x: 1, y: 2, zoom: 0.8 } });
    expect(saved.revision).toBe(1);
    expect(store.get("p1", "all").positions).toEqual([{ entityId: "claim:1", x: 120, y: 240 }]);
    expect(store.get("p1", "evidence").positions).toEqual([]);
    expect(store.get("p2", "all").positions).toEqual([]);
    store.close();
    const reopened = new ScientificCanvasLayoutStore(path);
    expect(reopened.get("p1", "all").viewport).toEqual({ x: 1, y: 2, zoom: 0.8 });
    reopened.close();
  });

  it("rejects stale optimistic revisions", () => {
    const store = new ScientificCanvasLayoutStore(join(mkdtempSync(join(tmpdir(), "xiling-layout-")), "layout.sqlite"));
    store.save({ projectId: "p1", view: "all", revision: 0, positions: [] });
    expect(() => store.save({ projectId: "p1", view: "all", revision: 0, positions: [] })).toThrow(ScientificCanvasLayoutConflictError);
    store.close();
  });
});

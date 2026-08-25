import { describe, expect, it } from "vitest";
import { reconcileCanvasSourceCoverage } from "./context-source-coverage.js";

describe("Canvas durable source coverage", () => {
  const longText = "海".repeat(2_001);
  const history = [{ id: "entry-long", role: "assistant" as const, text: longText, timestamp: 1 }];

  it("retains full history and exposes a source lookup when a Canvas node is truncated", () => {
    const result = reconcileCanvasSourceCoverage({
      history,
      nodes: [{ id: "preview", body: longText.slice(0, 2_000), sourceEntryId: "entry-long" }],
      getDurableEntry: () => ({ id: "entry-long", text: longText }),
    });
    expect(result.history).toEqual(history);
    expect(result.incompleteSources).toEqual([{ nodeId: "preview", sourceEntryId: "entry-long" }]);
  });

  it("deduplicates only an exact durable copy", () => {
    const result = reconcileCanvasSourceCoverage({
      history,
      nodes: [{ id: "full", body: longText, sourceEntryId: "entry-long" }],
      getDurableEntry: () => ({ id: "entry-long", text: longText }),
    });
    expect(result.history).toEqual([]);
    expect(result.incompleteSources).toEqual([]);
  });
});

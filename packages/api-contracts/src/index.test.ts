import { describe, expect, it } from "vitest";
import { canvasGraphSchema } from "./index.js";

describe("shared API contracts", () => {
  it("accepts a revisioned canvas graph and rejects an oversized node payload", () => {
    expect(canvasGraphSchema.parse({ version: 2, revision: 7, nodes: [], edges: [] }).revision).toBe(7);
    expect(canvasGraphSchema.safeParse({ version: 2, nodes: [{ id: "n", x: 0, y: 0, data: { eyebrow: "N", title: "node", body: "x".repeat(2_001), tone: "note" } }], edges: [] }).success).toBe(false);
  });

});

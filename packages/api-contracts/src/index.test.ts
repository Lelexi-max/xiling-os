import { describe, expect, it } from "vitest";
import { scientificCanvasLayoutSchema } from "./index.js";

describe("shared API contracts", () => {
  it("accepts revisioned Scientific Canvas positions and rejects invalid coordinates", () => {
    expect(scientificCanvasLayoutSchema.parse({ revision: 7, positions: [{ entityId: "paper:1", x: 1, y: 2 }] }).revision).toBe(7);
    expect(scientificCanvasLayoutSchema.safeParse({ revision: 0, positions: [{ entityId: "paper:1", x: Number.NaN, y: 2 }] }).success).toBe(false);
  });

});

import { describe, expect, it } from "vitest";
import type { ResearchGraphEntity, ResearchGraphRelation } from "@xiling/contracts";
import { arrangedPositions } from "./ScientificCanvasView.js";

const entity = (id: string, kind: ResearchGraphEntity["kind"]): ResearchGraphEntity => ({
  id, projectId: "project", kind, title: id, summary: id, properties: {}, revision: 1, contentHash: id.padEnd(64, "0").slice(0, 64), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
});
const relation = (id: string, sourceId: string, targetId: string, kind: ResearchGraphRelation["kind"]): ResearchGraphRelation => ({ id, projectId: "project", sourceId, targetId, kind, properties: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });

describe("Scientific Canvas semantic layout", () => {
  it("keeps questions and claims above assertions even when graph arrows point back to evaluated facts", () => {
    const positions = arrangedPositions(
      [entity("project", "Project"), entity("question", "ResearchQuestion"), entity("claim", "ClaimRevision"), entity("paper", "Paper"), entity("fragment", "SourceFragment"), entity("assertion", "EvidenceAssertion")],
      [relation("r1", "project", "question", "CONTAINS"), relation("r2", "paper", "fragment", "HAS_FRAGMENT"), relation("r3", "assertion", "fragment", "BASED_ON"), relation("r4", "assertion", "claim", "ASSERTS"), relation("r5", "assertion", "question", "EVALUATES")],
    );
    expect(positions.get("question")!.y).toBeLessThan(positions.get("assertion")!.y);
    expect(positions.get("claim")!.y).toBeLessThan(positions.get("assertion")!.y);
    expect(positions.get("fragment")!.y).toBeLessThan(positions.get("assertion")!.y);
  });
});

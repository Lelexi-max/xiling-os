import { describe, expect, it } from "vitest";
import type { ResearchGraphEntity } from "@xiling/contracts";
import { SourceContentResolver } from "./source-content-resolver.js";

const entity = (patch: Partial<ResearchGraphEntity>): ResearchGraphEntity => ({ id: "fragment:1", projectId: "p1", kind: "SourceFragment", title: "摘录", summary: "展示摘要", revision: 1, contentHash: "hash", properties: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...patch });

describe("SourceContentResolver", () => {
  it("returns exact evidence quotes and never labels a display summary as source text", async () => {
    const resolver = new SourceContentResolver({
      getWikiPage: () => undefined,
      listEvidence: () => [{ id: "e1", projectId: "p1", paper: { id: "paper", title: "Paper", year: 2025, authors: [], citationCount: 0, references: [], source: "fixture" }, note: "解释", stance: "supports", confidence: 0.8, sourceQuote: "Exact quoted observation.", sourceLocator: "paper://page/4", limitations: "summer only", createdAt: "2026-01-01T00:00:00.000Z" }],
      getAgentRun: () => undefined, getWorkflow: () => undefined,
      readArtifact: async () => ({ text: "", truncated: false }),
    });
    await expect(resolver.resolve("p1", entity({ properties: { evidenceRecordId: "e1" } }))).resolves.toMatchObject({ body: "Exact quoted observation.", sourceLabel: "证据原文摘录", sourceLocator: "paper://page/4" });
    await expect(resolver.resolve("p1", entity({ id: "question", kind: "ResearchQuestion", summary: "展示摘要" }))).resolves.toMatchObject({ body: "展示摘要", sourceLabel: "科研图结构化摘要（非原文）" });
  });
});

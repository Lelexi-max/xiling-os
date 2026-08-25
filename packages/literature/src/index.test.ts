import { describe, expect, it } from "vitest";
import { buildLiteratureGraph, createOceanHeatwaveFixture } from "./index.js";

describe("Connected Papers style literature graph", () => {
  it("builds deterministic citation, co-citation and coupling edges", () => {
    const fixture = createOceanHeatwaveFixture();
    const graph = buildLiteratureGraph(fixture.papers, fixture.seedIds, { fetchedAt: "2026-08-23T00:00:00.000Z" });
    expect(graph.nodes).toHaveLength(9);
    expect(graph.nodes.find((node) => node.id === "seed-mhw")?.seed).toBe(true);
    expect(new Set(graph.edges.map((edge) => edge.kind))).toEqual(new Set(["citation", "recommendation", "co-citation", "bibliographic-coupling"]));
    expect(graph.provider).toBe("fixture");
  });

  it("caps graph expansion at 100 nodes", () => {
    const fixture = createOceanHeatwaveFixture();
    const expanded = Array.from({ length: 120 }, (_, index) => ({ ...fixture.papers[0]!, id: `paper-${index}`, references: [] }));
    expanded[0] = { ...expanded[0]!, id: "seed" };
    expect(buildLiteratureGraph(expanded, ["seed"], { limit: 500 }).nodes).toHaveLength(100);
  });

  it("ignores malformed self citations from upstream metadata", () => {
    const fixture = createOceanHeatwaveFixture();
    fixture.papers[0] = { ...fixture.papers[0]!, references: [fixture.papers[0]!.id] };
    const graph = buildLiteratureGraph(fixture.papers, fixture.seedIds);
    expect(graph.edges.some((edge) => edge.kind === "citation" && edge.source === edge.target)).toBe(false);
  });
});

import type { LiteratureGraph, LiteratureGraphEdge, LiteratureGraphNode, PaperRecord } from "@xiling/contracts";
export * from "./providers.js";

const pairId = (kind: LiteratureGraphEdge["kind"], left: string, right: string) => `${kind}:${[left, right].sort().join(":")}`;

export function buildLiteratureGraph(papers: PaperRecord[], seedIds: string[], options: { limit?: number; fetchedAt?: string } = {}): LiteratureGraph {
  const limit = Math.min(Math.max(options.limit ?? 40, 1), 100);
  const unique = new Map(papers.map((paper) => [paper.id, paper]));
  const seeds = new Set(seedIds.filter((id) => unique.has(id)));
  if (seeds.size === 0) throw new Error("at least one valid seed paper is required");

  const relevance = (paper: PaperRecord) => {
    if (seeds.has(paper.id)) return 1;
    const citedBySeed = [...seeds].filter((seed) => unique.get(seed)?.references.includes(paper.id)).length;
    const citesSeed = paper.references.filter((reference) => seeds.has(reference)).length;
    const seedReferences = new Set([...seeds].flatMap((seed) => unique.get(seed)?.references ?? []));
    const shared = paper.references.filter((reference) => seedReferences.has(reference)).length;
    return citedBySeed * 0.45 + citesSeed * 0.35 + Math.min(shared * 0.1, 0.2);
  };
  const chosen = [...unique.values()]
    .map((paper) => ({ paper, relevance: relevance(paper) }))
    .sort((left, right) => Number(seeds.has(right.paper.id)) - Number(seeds.has(left.paper.id)) || right.relevance - left.relevance || right.paper.citationCount - left.paper.citationCount)
    .slice(0, limit);
  const chosenIds = new Set(chosen.map(({ paper }) => paper.id));
  const nodes: LiteratureGraphNode[] = chosen.map(({ paper, relevance: score }) => ({ ...paper, seed: seeds.has(paper.id), relevance: Number(score.toFixed(3)) }));
  const edges: LiteratureGraphEdge[] = [];

  for (const paper of nodes) {
    for (const reference of paper.references) {
      if (reference !== paper.id && chosenIds.has(reference)) edges.push({ id: `citation:${paper.id}:${reference}`, source: paper.id, target: reference, kind: "citation", score: 1 });
    }
  }
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const left = nodes[leftIndex];
      const right = nodes[rightIndex];
      if (!left || !right) continue;
      const sharedReferences = left.references.filter((reference) => right.references.includes(reference)).length;
      const union = new Set([...left.references, ...right.references]).size;
      if (sharedReferences > 0 && union > 0) edges.push({ id: pairId("bibliographic-coupling", left.id, right.id), source: left.id, target: right.id, kind: "bibliographic-coupling", score: Number((sharedReferences / union).toFixed(3)) });
      const coCitation = nodes.filter((paper) => paper.references.includes(left.id) && paper.references.includes(right.id)).length;
      if (coCitation > 0) edges.push({ id: pairId("co-citation", left.id, right.id), source: left.id, target: right.id, kind: "co-citation", score: coCitation });
      if ((left.seed || right.seed) && !left.references.includes(right.id) && !right.references.includes(left.id) && (left.relevance > 0 || right.relevance > 0)) {
        edges.push({ id: pairId("recommendation", left.id, right.id), source: left.id, target: right.id, kind: "recommendation", score: Math.max(left.relevance, right.relevance) });
      }
    }
  }
  return {
    seedIds: [...seeds],
    nodes,
    edges,
    algorithm: "seed-neighborhood + citation + co-citation + Jaccard bibliographic coupling; deterministic v1",
    provider: papers.every((paper) => paper.source === "fixture") ? "fixture" : papers.some((paper) => paper.source === "semantic-scholar") ? "semantic-scholar" : "openalex",
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
  };
}

export function createOceanHeatwaveFixture(): { papers: PaperRecord[]; seedIds: string[] } {
  const paper = (id: string, title: string, year: number, citationCount: number, references: string[], authors: string[]): PaperRecord => ({ id, title, year, citationCount, references, authors, source: "fixture", url: `https://example.invalid/papers/${id}` });
  return {
    seedIds: ["seed-mhw"],
    papers: [
      paper("seed-mhw", "Upper-ocean stratification and marine heatwave persistence", 2023, 82, ["mld", "mechanism", "argo-method"], ["Lin", "Chen"]),
      paper("mld", "Mixed-layer depth controls on extreme ocean warming", 2020, 214, ["classic-heat", "argo-method"], ["Holbrook"]),
      paper("mechanism", "Ocean stratification amplifies surface heat extremes", 2021, 176, ["classic-heat", "flux"], ["Li", "Oliver"]),
      paper("argo-method", "A global Argo climatology of mixed-layer properties", 2019, 305, ["argo-qc", "mld-algo"], ["de Boyer Montégut"]),
      paper("regional", "Northwest Pacific marine heatwaves in 2023", 2024, 34, ["seed-mhw", "mechanism", "flux"], ["Wang"]),
      paper("flux", "Air-sea flux feedbacks during persistent marine heatwaves", 2018, 190, ["classic-heat"], ["Benthuysen"]),
      paper("mld-algo", "Temperature threshold estimates of ocean mixed layers", 2004, 811, ["argo-qc"], ["de Boyer Montégut"]),
      paper("argo-qc", "Argo quality control and delayed-mode practices", 2017, 98, [], ["Wong"]),
      paper("classic-heat", "A global assessment of marine heatwaves", 2016, 1720, [], ["Hobday"]),
    ],
  };
}

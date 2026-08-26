import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PaperRecord } from "@xiling/contracts";
import { FileLiteratureCache, LiteratureHttpError, LiteratureSearchService, OpenAlexProvider, SemanticScholarProvider, withLiteratureRetry, type LiteratureProvider } from "./providers.js";

const paper = (id: string, source: PaperRecord["source"]): PaperRecord => ({ id, title: `Paper ${id}`, year: 2024, authors: ["Ocean Author"], citationCount: 7, references: [], source });
const provider = (id: LiteratureProvider["id"], search: LiteratureProvider["search"]): LiteratureProvider => ({ id, search });

describe("literature providers and cache", () => {
  it("projects only requested Semantic Scholar fields and sends an optional key as a header", async () => {
    let requested = ""; let key = "";
    const fetchFn: typeof fetch = async (input, init) => {
      requested = String(input); key = new Headers(init?.headers).get("x-api-key") ?? "";
      return new Response(JSON.stringify({ data: [{ paperId: "s2-1", title: "Marine heatwave", year: 2023, authors: [{ name: "Lin" }], citationCount: 12, references: [{ paperId: "ref-1" }], url: "https://example.test/s2-1", abstract: "Observed upper-ocean warming." }] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const result = await new SemanticScholarProvider(fetchFn, "fixture-key").search("marine-heatwave", 12);
    expect(requested).toContain("limit=12"); expect(requested).toContain("fields=title%2Cyear%2Cauthors%2CcitationCount%2Creferences.paperId%2Curl%2Cabstract"); expect(requested).toContain("marine+heatwave");
    expect(key).toBe("fixture-key"); expect(result).toEqual([{ id: "s2-1", title: "Marine heatwave", year: 2023, authors: ["Lin"], citationCount: 12, references: ["ref-1"], source: "semantic-scholar", url: "https://example.test/s2-1", abstract: "Observed upper-ocean warming." }]);
  });

  it("maps OpenAlex works into the same paper contract", async () => {
    let requested = "";
    const fetchFn: typeof fetch = async (input) => {
      requested = String(input);
      return new Response(JSON.stringify({ results: [{ id: "https://openalex.org/W1", display_name: "Stratification", publication_year: 2022, authorships: [{ author: { display_name: "Chen" } }], cited_by_count: 18, referenced_works: ["https://openalex.org/W2"], doi: "https://doi.org/10.fixture/1", abstract_inverted_index: { Ocean: [0], heat: [1] } }] }), { status: 200 });
    };
    expect(await new OpenAlexProvider(fetchFn).search("stratification", 5)).toEqual([{ id: "W1", title: "Stratification", year: 2022, authors: ["Chen"], citationCount: 18, references: ["W2"], source: "openalex", url: "https://doi.org/10.fixture/1", abstract: "Ocean heat" }]);
    expect(new URL(requested).searchParams.get("sort")).toBe("relevance_score:desc");
  });

  it("honors capped Retry-After delays and reports the successful attempt", async () => {
    let calls = 0; const delays: number[] = [];
    const result = await withLiteratureRetry(async () => { calls += 1; if (calls < 3) throw new LiteratureHttpError("semantic-scholar", 429, 20_000); return "ok"; }, { attempts: 3, maxDelayMs: 1_500, sleep: async (ms) => { delays.push(ms); } });
    expect(result).toEqual({ value: "ok", attempts: 3 }); expect(delays).toEqual([1_500, 1_500]);
  });

  it("caches projected results, falls back to OpenAlex, and serves stale cache if both providers fail", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-literature-")); let primaryCalls = 0; let fallbackCalls = 0; let now = new Date("2026-08-23T00:00:00.000Z");
    const primary = provider("semantic-scholar", async () => { primaryCalls += 1; throw new LiteratureHttpError("semantic-scholar", 503); });
    let fallbackFails = false;
    const fallback = provider("openalex", async () => { fallbackCalls += 1; if (fallbackFails) throw new LiteratureHttpError("openalex", 503); return [paper("W1", "openalex")]; });
    const service = new LiteratureSearchService(primary, fallback, new FileLiteratureCache(root), { ttlMs: 1_000, now: () => now, retry: { attempts: 1 } });
    const first = await service.search("ocean warming", 10); expect(first).toMatchObject({ provider: "openalex", degradedFrom: "semantic-scholar", cache: "miss", attempts: 2 });
    const hit = await service.search(" ocean warming ", 10); expect(hit.cache).toBe("hit"); expect(primaryCalls).toBe(1); expect(fallbackCalls).toBe(1);
    now = new Date("2026-08-23T00:00:02.000Z"); fallbackFails = true;
    const stale = await service.search("ocean warming", 10); expect(stale.cache).toBe("stale"); expect(stale.papers[0]?.id).toBe("W1");
  });

  it("coalesces concurrent searches for the same normalized query", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-literature-inflight-")); let calls = 0;
    const primary = provider("semantic-scholar", async () => { calls += 1; await new Promise((resolvePromise) => setTimeout(resolvePromise, 5)); return [paper("s2", "semantic-scholar")]; });
    const fallback = provider("openalex", async () => []);
    const service = new LiteratureSearchService(primary, fallback, new FileLiteratureCache(root));
    const [first, second] = await Promise.all([service.search("ARGO profiles", 20), service.search(" ARGO profiles ", 20)]);
    expect(calls).toBe(1); expect(first.sourceHash).toBe(second.sourceHash);
  });
});

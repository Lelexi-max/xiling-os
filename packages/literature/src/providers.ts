import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { LiteratureSearchResponse, PaperRecord } from "@xiling/contracts";

export type LiteratureFetch = typeof globalThis.fetch;
export interface LiteratureProvider {
  readonly id: "semantic-scholar" | "openalex";
  search(query: string, limit: number, signal?: AbortSignal): Promise<PaperRecord[]>;
}

export class LiteratureHttpError extends Error {
  constructor(readonly provider: string, readonly status: number, readonly retryAfterMs?: number) { super(`${provider} request failed with ${status}`); }
}

const parseRetryAfter = (value: string | null, now = Date.now()): number | undefined => {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value); return Number.isNaN(date) ? undefined : Math.max(0, date - now);
};

async function jsonRequest(fetchFn: LiteratureFetch, provider: string, url: URL, headers: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  const response = await fetchFn(url, { headers, ...(signal ? { signal } : {}) });
  if (!response.ok) throw new LiteratureHttpError(provider, response.status, parseRetryAfter(response.headers.get("retry-after")));
  return response.json() as Promise<unknown>;
}

const text = (value: unknown): string => typeof value === "string" ? value : "";
const integer = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export class SemanticScholarProvider implements LiteratureProvider {
  readonly id = "semantic-scholar" as const;
  constructor(private readonly fetchFn: LiteratureFetch = fetch, private readonly apiKey?: string | (() => string | undefined)) {}
  async search(query: string, limit: number, signal?: AbortSignal): Promise<PaperRecord[]> {
    const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
    url.searchParams.set("query", query.replaceAll("-", " "));
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("fields", "title,year,authors,citationCount,references.paperId,url");
    const apiKey = typeof this.apiKey === "function" ? this.apiKey() : this.apiKey;
    const body = record(await jsonRequest(this.fetchFn, this.id, url, apiKey ? { "x-api-key": apiKey } : {}, signal));
    return array(body.data).map((item) => {
      const paper = record(item);
      return {
        id: text(paper.paperId), title: text(paper.title), year: integer(paper.year),
        authors: array(paper.authors).map((author) => text(record(author).name)).filter(Boolean),
        citationCount: integer(paper.citationCount),
        references: array(paper.references).map((reference) => text(record(reference).paperId)).filter(Boolean),
        source: this.id, ...(text(paper.url) ? { url: text(paper.url) } : {}),
      } satisfies PaperRecord;
    }).filter((paper) => paper.id && paper.title);
  }
}

const openAlexId = (value: unknown): string => text(value).replace(/^https:\/\/openalex\.org\//, "");

export class OpenAlexProvider implements LiteratureProvider {
  readonly id = "openalex" as const;
  constructor(private readonly fetchFn: LiteratureFetch = fetch, private readonly apiKey?: string | (() => string | undefined)) {}
  async search(query: string, limit: number, signal?: AbortSignal): Promise<PaperRecord[]> {
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set("search", query); url.searchParams.set("per_page", String(limit)); url.searchParams.set("sort", "relevance_score:desc");
    url.searchParams.set("select", "id,display_name,publication_year,authorships,cited_by_count,referenced_works,doi");
    const apiKey = typeof this.apiKey === "function" ? this.apiKey() : this.apiKey;
    if (apiKey) url.searchParams.set("api_key", apiKey);
    const body = record(await jsonRequest(this.fetchFn, this.id, url, {}, signal));
    return array(body.results).map((item) => {
      const work = record(item);
      return {
        id: openAlexId(work.id), title: text(work.display_name), year: integer(work.publication_year),
        authors: array(work.authorships).map((authorship) => text(record(record(authorship).author).display_name)).filter(Boolean),
        citationCount: integer(work.cited_by_count), references: array(work.referenced_works).map(openAlexId).filter(Boolean), source: this.id,
        ...(text(work.doi) ? { url: text(work.doi) } : text(work.id) ? { url: text(work.id) } : {}),
      } satisfies PaperRecord;
    }).filter((paper) => paper.id && paper.title);
  }
}

export interface RetryPolicy { attempts?: number; baseDelayMs?: number; maxDelayMs?: number; sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; }
const defaultSleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolvePromise, reject) => {
  const timer = setTimeout(resolvePromise, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
});

export async function withLiteratureRetry<T>(operation: () => Promise<T>, policy: RetryPolicy = {}): Promise<{ value: T; attempts: number }> {
  const attempts = Math.min(Math.max(policy.attempts ?? 3, 1), 5); const base = policy.baseDelayMs ?? 300; const cap = policy.maxDelayMs ?? 5_000; const sleep = policy.sleep ?? defaultSleep;
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return { value: await operation(), attempts: attempt }; }
    catch (error) {
      last = error;
      const retryable = error instanceof LiteratureHttpError ? error.status === 429 || error.status >= 500 : error instanceof Error && error.name !== "AbortError";
      if (!retryable || attempt === attempts) throw Object.assign(error instanceof Error ? error : new Error(String(error)), { attempts: attempt });
      const requested = (error instanceof LiteratureHttpError ? error.retryAfterMs : undefined) ?? base * (2 ** (attempt - 1));
      await sleep(Math.min(requested, cap));
    }
  }
  throw last;
}

type CacheFile = { version: 1; expiresAt: string; response: LiteratureSearchResponse };
export class FileLiteratureCache {
  constructor(private readonly root: string) {}
  key(query: string, limit: number): string { return createHash("sha256").update(`${query.trim().toLowerCase()}\n${limit}`).digest("hex"); }
  async read(key: string): Promise<CacheFile | undefined> {
    try { return JSON.parse(await readFile(resolve(this.root, `${key}.json`), "utf8")) as CacheFile; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  async write(key: string, file: CacheFile): Promise<void> {
    await mkdir(this.root, { recursive: true }); const path = resolve(this.root, `${key}.json`); const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, "utf8"); await rename(temporary, path);
  }
}

export class LiteratureSearchService {
  private readonly inflight = new Map<string, Promise<LiteratureSearchResponse>>();
  constructor(
    private readonly primary: LiteratureProvider,
    private readonly fallback: LiteratureProvider,
    private readonly cache: FileLiteratureCache,
    private readonly options: { ttlMs?: number; now?: () => Date; retry?: RetryPolicy } = {},
  ) {}
  async search(query: string, limit = 20, signal?: AbortSignal): Promise<LiteratureSearchResponse> {
    const normalized = query.trim(); if (normalized.length < 2 || normalized.length > 200) throw new Error("literature query must contain 2-200 characters");
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 5), 40); const now = this.options.now?.() ?? new Date(); const key = this.cache.key(normalized, boundedLimit); const cached = await this.cache.read(key);
    if (cached && Date.parse(cached.expiresAt) > now.getTime()) return { ...cached.response, cache: "hit" };
    const running = this.inflight.get(key); if (running) return running;
    const pending = this.fetchAndCache(normalized, boundedLimit, key, now, cached, signal); this.inflight.set(key, pending);
    try { return await pending; } finally { this.inflight.delete(key); }
  }

  private async fetchAndCache(normalized: string, boundedLimit: number, key: string, now: Date, cached: CacheFile | undefined, signal?: AbortSignal): Promise<LiteratureSearchResponse> {
    try {
      let provider: LiteratureProvider = this.primary; let degradedFrom: "semantic-scholar" | undefined; let result: { value: PaperRecord[]; attempts: number }; let totalAttempts = 0;
      try { result = await withLiteratureRetry(() => this.primary.search(normalized, boundedLimit, signal), this.options.retry); totalAttempts = result.attempts; }
      catch (primaryError) {
        provider = this.fallback; degradedFrom = "semantic-scholar"; totalAttempts = integer(record(primaryError).attempts) || 1;
        try { result = await withLiteratureRetry(() => this.fallback.search(normalized, boundedLimit, signal), this.options.retry); totalAttempts += result.attempts; }
        catch (fallbackError) { Object.assign(fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)), { primaryError }); throw fallbackError; }
      }
      const fetchedAt = now.toISOString(); const sourceHash = createHash("sha256").update(JSON.stringify(result.value)).digest("hex");
      const response: LiteratureSearchResponse = { query: normalized, papers: result.value, provider: provider.id, fetchedAt, cache: "miss", sourceHash, ...(degradedFrom ? { degradedFrom } : {}), attempts: totalAttempts };
      await this.cache.write(key, { version: 1, expiresAt: new Date(now.getTime() + (this.options.ttlMs ?? 24 * 60 * 60 * 1_000)).toISOString(), response }); return response;
    } catch (error) {
      if (cached) return { ...cached.response, cache: "stale" };
      throw error;
    }
  }
}

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  CanvasEdge,
  CanvasNode,
  DatasetMetadata,
  DatasetSlicePlan,
  Gate3ProjectSnapshot,
  ResearchApproval,
  ResearchRun,
  ReviewerReport,
  ResourceUri,
  WikiRevision,
} from "@xiling/contracts";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

const stableHash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");

export interface ResearchRunner {
  execute(plan: DatasetSlicePlan, signal?: AbortSignal): Promise<{ artifactUris: ResourceUri[]; checks: ReviewerReport["checks"] }>;
}

export interface Clock {
  now(): string;
}

const systemClock: Clock = { now: () => new Date().toISOString() };

export function createArgoMetadata(): DatasetMetadata {
  return {
    uri: "dataset://argo-gate3-fixture",
    title: "Gate 3 西北太平洋 Argo 温盐剖面",
    format: "NetCDF",
    variables: [
      { name: "TEMP", units: "degree_Celsius", dimensions: ["N_PROF", "N_LEVELS"] },
      { name: "PSAL", units: "1e-3", dimensions: ["N_PROF", "N_LEVELS"] },
      { name: "PRES", units: "dbar", dimensions: ["N_PROF", "N_LEVELS"] },
      { name: "POSITION_QC", units: "1", dimensions: ["N_PROF"] },
    ],
    bounds: { west: 130, east: 150, south: 10, north: 30, minDepth: 0, maxDepth: 200, start: "2023-07-01", end: "2023-08-31" },
    byteSize: 18432,
    sha256: "fixture-generated-in-runner",
  };
}

export function createSlicePlan(metadata: DatasetMetadata): DatasetSlicePlan {
  const input = {
    datasetUri: metadata.uri,
    variables: ["TEMP", "PSAL", "PRES", "POSITION_QC"],
    region: { west: 132, east: 148, south: 12, north: 28 },
    depth: { min: 0, max: 150 },
    time: { start: "2023-07-01", end: "2023-08-31" },
    estimatedBytes: 12288,
    targetUri: "artifact://argo-gate3-snapshot" as ResourceUri,
  };
  return { id: "plan-argo-gate3", ...input, planHash: stableHash(input) };
}

export class JsonProjectRepository {
  constructor(private readonly path: string) {}

  async load(): Promise<Gate3ProjectSnapshot | undefined> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as Gate3ProjectSnapshot;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async save(snapshot: Gate3ProjectSnapshot): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await rename(temporary, this.path);
  }
}

export class Gate3ResearchService {
  private snapshot: Gate3ProjectSnapshot;
  private running = false;

  constructor(
    private readonly repository: JsonProjectRepository,
    private readonly runner: ResearchRunner,
    private readonly clock: Clock = systemClock,
  ) {
    this.snapshot = {
      projectId: "ocean-heatwave-gate3",
      researchQuestion: "西北太平洋上层海洋层结是否放大 2023 年海洋热浪？",
      canvasNodes: [],
      canvasEdges: [],
      wikiRevisions: [],
      updatedAt: this.clock.now(),
    };
  }

  async initialize(): Promise<Gate3ProjectSnapshot> {
    this.snapshot = (await this.repository.load()) ?? this.snapshot;
    if (this.snapshot.run?.status === "running") {
      this.snapshot = {
        ...this.snapshot,
        run: { ...this.snapshot.run, status: "failed", finishedAt: this.clock.now() },
        updatedAt: this.clock.now(),
      };
      await this.persist();
    }
    return this.getSnapshot();
  }

  getSnapshot(): Gate3ProjectSnapshot {
    return structuredClone(this.snapshot);
  }

  async plan(): Promise<Gate3ProjectSnapshot> {
    if (this.running) throw new Error("Cannot replace a plan while a run is active");
    const dataset = createArgoMetadata();
    const plan = createSlicePlan(dataset);
    const approval: ResearchApproval = {
      id: "approval-argo-gate3",
      projectId: this.snapshot.projectId,
      planHash: plan.planHash,
      resources: [dataset.uri, plan.targetUri],
      status: "pending",
      createdAt: this.clock.now(),
    };
    const datasetNode: CanvasNode = {
      id: "gate3-dataset",
      projectId: this.snapshot.projectId,
      kind: "dataset",
      title: "Argo 温盐剖面",
      summary: "等待切片审批",
      artifactUri: dataset.uri,
      createdAt: this.clock.now(),
    };
    const { run: _previousRun, review: _previousReview, ...baseSnapshot } = this.snapshot;
    this.snapshot = {
      ...baseSnapshot,
      dataset,
      plan,
      approval,
      canvasNodes: [datasetNode],
      canvasEdges: [],
      wikiRevisions: [],
      updatedAt: this.clock.now(),
    };
    await this.persist();
    return this.getSnapshot();
  }

  async approve(approvalId: string): Promise<Gate3ProjectSnapshot> {
    const approval = this.snapshot.approval;
    if (!approval || approval.id !== approvalId || approval.status !== "pending") throw new Error("Approval is not pending");
    this.snapshot = { ...this.snapshot, approval: { ...approval, status: "approved", decidedAt: this.clock.now() }, updatedAt: this.clock.now() };
    await this.persist();
    return this.getSnapshot();
  }

  async run(signal?: AbortSignal): Promise<Gate3ProjectSnapshot> {
    if (this.running) throw new Error("Run rejected: another run is already active");
    const { approval, plan } = this.snapshot;
    if (!approval || approval.status !== "approved") throw new Error("Run rejected: explicit approval is required");
    if (!plan || approval.planHash !== plan.planHash) throw new Error("Run rejected: approved plan hash does not match");
    if (signal?.aborted) throw new Error("Run cancelled before start");
    this.running = true;
    const startedAt = this.clock.now();
    const run: ResearchRun = { id: `run-${randomUUID()}`, projectId: this.snapshot.projectId, planId: plan.id, status: "running", artifactUris: [], startedAt };
    this.snapshot = { ...this.snapshot, run, updatedAt: startedAt };
    await this.persist();

    try {
      const result = await this.runner.execute(plan, signal);
      const primaryArtifact = result.artifactUris[0];
      if (!primaryArtifact) throw new Error("Runner returned no artifacts");
      const finishedRun: ResearchRun = { ...run, status: "succeeded", artifactUris: result.artifactUris, finishedAt: this.clock.now() };
      const verdict = result.checks.every((check) => check.passed) ? "accepted" : "rejected";
      const review: ReviewerReport = {
        id: `review-${randomUUID()}`,
        runId: run.id,
        verdict,
        checks: result.checks,
        limitations: ["固定小型 Argo fixture 仅验证方法闭环，不代表真实海盆统计显著性。"],
        createdAt: this.clock.now(),
      };
      const artifactNode: CanvasNode = {
        id: `artifact-${run.id}`,
        projectId: this.snapshot.projectId,
        kind: "artifact",
        title: "混合层深度与热含量结果",
        summary: `Reviewer: ${verdict}`,
        artifactUri: primaryArtifact,
        parentId: "gate3-dataset",
        createdAt: this.clock.now(),
      };
      const edge: CanvasEdge = { id: `edge-${run.id}`, source: "gate3-dataset", target: artifactNode.id, kind: "produced" };
      const revision: WikiRevision = {
        id: `wiki-${run.id}`,
        pageId: "gate3-findings",
        title: "Gate 3：Argo 观测验证",
        markdown: `## 结论\n\n固定样例运行状态：**${verdict}**。\n\n## 局限\n\n${review.limitations[0]}`,
        artifactUris: result.artifactUris,
        createdAt: this.clock.now(),
      };
      this.snapshot = {
        ...this.snapshot,
        run: finishedRun,
        review,
        canvasNodes: [...this.snapshot.canvasNodes, artifactNode],
        canvasEdges: [...this.snapshot.canvasEdges, edge],
        wikiRevisions: [...this.snapshot.wikiRevisions, revision],
        updatedAt: this.clock.now(),
      };
      await this.persist();
      return this.getSnapshot();
    } catch (error) {
      this.snapshot = { ...this.snapshot, run: { ...run, status: signal?.aborted ? "cancelled" : "failed", finishedAt: this.clock.now() }, updatedAt: this.clock.now() };
      await this.persist();
      throw error;
    } finally {
      this.running = false;
    }
  }

  private async persist() {
    await this.repository.save(this.snapshot);
  }
}

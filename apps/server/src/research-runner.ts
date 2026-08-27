import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { ProjectResearchWorkflow, ResourceUri, ReviewerReport } from "@xiling/contracts";
import type { ProjectAnalysisRunner } from "./project-workflow.js";

const executeFile = promisify(execFile);

interface RunnerResult {
  outputs: Array<{ path: string; sha256: string }>;
  review: { verdict: "accepted" | "rejected"; checks: ReviewerReport["checks"] };
  roCrate: string;
}

function isSafeArtifactPath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("\\") && !path.split("/").includes("..");
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export class DockerProjectAnalysisRunner implements ProjectAnalysisRunner {
  constructor(private readonly gate4Root: string, private readonly image = "xiling-runner:gate4") {}

  async execute(workflow: ProjectResearchWorkflow, signal?: AbortSignal) {
    if (workflow.request.connectorId !== "argo-gdac" || workflow.request.outputFormat !== "NetCDF") throw new Error("首版原生分析配方仅支持 Argo GDAC NetCDF");
    if (!workflow.datasetArtifact?.uri.startsWith("artifact://connector/")) throw new Error("真实分析要求受控连接器生成的 NetCDF Artifact");
    const match = /^artifact:\/\/connector\/([0-9a-f-]{36})\/(.+)$/.exec(workflow.datasetArtifact.uri);
    if (!match || !isSafeArtifactPath(match[2]!)) throw new Error("invalid connector Artifact URI");
    const inputPath = resolve(this.gate4Root, "connector-runs", match[1]!, "artifacts", match[2]!);
    const runRoot = resolve(this.gate4Root, "project-runs", workflow.id);
    await mkdir(runRoot, { recursive: true });
    const request = workflow.request;
    const plan = { id: workflow.id, datasetUri: workflow.datasetArtifact.uri, variables: request.variables, region: request.region, depth: request.depth ?? { min: 0, max: 2_000 }, time: request.time, estimatedBytes: workflow.datasetArtifact.bytes, targetUri: `artifact://workflow/${workflow.id}` as ResourceUri, planHash: createHash("sha256").update(JSON.stringify(request)).digest("hex") };
    const planPath = join(runRoot, "plan.json"); await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    const created = await executeFile("docker", ["create", "--network", "none", "--memory", "4g", "--cpus", "2", this.image, "python", "run_gate3.py", "--plan", "/workspace/plan.json", "--input", "/workspace/input.nc", "--workspace", "/workspace"], { signal, timeout: 15_000, maxBuffer: 1024 * 1024 });
    const containerId = created.stdout.trim(); if (!containerId) throw new Error("Docker did not return a container id");
    try {
      await executeFile("docker", ["cp", planPath, `${containerId}:/workspace/plan.json`], { signal, timeout: 15_000 });
      await executeFile("docker", ["cp", inputPath, `${containerId}:/workspace/input.nc`], { signal, timeout: 30_000 });
      await executeFile("docker", ["start", "--attach", containerId], { signal, timeout: 120_000, maxBuffer: 1024 * 1024 });
      await executeFile("docker", ["cp", `${containerId}:/workspace/.`, runRoot], { signal, timeout: 30_000 });
    } finally { await executeFile("docker", ["rm", "--force", containerId], { timeout: 15_000 }).catch(() => undefined); }
    const result = JSON.parse(await readFile(join(runRoot, "result.json"), "utf8")) as RunnerResult;
    if (!Array.isArray(result.outputs) || !result.outputs.length || !result.outputs.every((output) => isSafeArtifactPath(output.path) && /^[a-f0-9]{64}$/.test(output.sha256))) throw new Error("Runner returned an invalid artifact manifest");
    for (const output of result.outputs) if (await sha256(resolve(runRoot, "artifacts", output.path)) !== output.sha256) throw new Error(`Artifact hash mismatch: ${output.path}`);
    if (!Array.isArray(result.review?.checks) || !result.review.checks.length) throw new Error("Runner returned no reviewer checks");
    await readFile(resolve(runRoot, "artifacts", "ro-crate", "ro-crate-metadata.json"));
    return { artifactUris: [...result.outputs.map((output) => `artifact://workflow/${workflow.id}/${output.path}` as ResourceUri), `artifact://workflow/${workflow.id}/ro-crate/ro-crate-metadata.json` as ResourceUri], checks: result.review.checks, limitations: result.review.verdict === "accepted" ? ["分析结论仍需领域专家结合采样偏差和统计显著性复核。"] : ["Reviewer 检查未全部通过，不能作为科研结论。"] };
  }
}

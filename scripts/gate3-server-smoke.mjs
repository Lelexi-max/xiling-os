import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArgoMetadata, createSlicePlan } from "../packages/research/dist/index.js";
import { DockerArgoResearchRunner } from "../apps/server/dist/research-runner.js";

const root = await mkdtemp(join(tmpdir(), "xiling-server-runner-"));
try {
  const result = await new DockerArgoResearchRunner(root).execute(createSlicePlan(createArgoMetadata()));
  if (result.artifactUris.length !== 7) throw new Error(`Expected 7 artifact URIs, received ${result.artifactUris.length}`);
  if (!result.checks.every((check) => check.passed)) throw new Error("Gate 3 server runner review failed");
  console.log(JSON.stringify({ status: "ok", adapter: "DockerArgoResearchRunner", artifacts: 7, checks: result.checks.length }));
} finally {
  await rm(root, { recursive: true, force: true });
}

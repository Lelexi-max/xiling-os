import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOceanResearchFixture, LadybugResearchGraphStore } from "../packages/research-graph/dist/index.js";

const crashFlag = "--crash-child";

if (process.argv[2] === crashFlag) {
  const databasePath = process.argv[3];
  if (!databasePath) process.exit(2);
  const store = new LadybugResearchGraphStore(databasePath);
  await store.initialize();
  await store.applyChangeSet({
    projectId: "ocean-heatwave-rg0",
    nodes: [{ id: "wal-survivor", projectId: "ocean-heatwave-rg0", kind: "LifecycleEvent", title: "已提交但未优雅关闭的事件", status: "available" }],
    relations: [],
  });
  process.exit(86);
}

const directory = await mkdtemp(join(tmpdir(), "xiling-research-graph-smoke-"));
const databasePath = join(directory, "research-graph.lbdb");
let store;
try {
  store = new LadybugResearchGraphStore(databasePath);
  const health = await store.initialize();
  if (health.engine !== "ladybugdb" || health.schemaVersion !== 2) throw new Error("Unexpected Research Graph health response");

  const fixture = createOceanResearchFixture();
  await store.applyChangeSet(fixture);
  const evidence = await store.getEvidenceForClaim(fixture.projectId, "claim");
  if (evidence.length !== 2 || !evidence.some((item) => item.stance === "supports") || !evidence.some((item) => item.stance === "refutes")) {
    throw new Error("Research Graph evidence query did not preserve conflicting stances");
  }
  const lineage = await store.traceArtifact(fixture.projectId, "artifact-v1");
  if (lineage?.run?.id !== "run" || lineage.inputs.length !== 2 || lineage.reviews.length !== 1) {
    throw new Error("Research Graph provenance query returned an incomplete lineage");
  }
  const ledgerEnvelope = { projectionKey: "smoke:projection:v1", source: "workflow", sourceId: "smoke", changeSet: { projectId: fixture.projectId, nodes: [], relations: [] } };
  const firstProjection = await store.applyProjection(ledgerEnvelope);
  const replayedProjection = await store.applyProjection(ledgerEnvelope);
  if (!firstProjection.applied || replayedProjection.applied) throw new Error("Research Graph applied ledger is not idempotent");
  await store.checkpoint();
  await store.close();
  store = undefined;

  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), crashFlag, databasePath], {
    stdio: "pipe",
    encoding: "utf8",
    shell: false,
  });
  if (child.status !== 86) throw new Error(`Crash child did not reach committed exit: ${child.stderr || child.stdout}`);

  const recovered = new LadybugResearchGraphStore(databasePath);
  await recovered.initialize();
  const survivor = await recovered.getEntity(fixture.projectId, "wal-survivor");
  if (!survivor) throw new Error("Committed Research Graph event was lost after abrupt process exit");
  const projection = await recovered.getProjection(fixture.projectId, "all");
  if (projection.nodes.length !== 19 || projection.relations.length !== 20) throw new Error("Research Graph recovery changed committed topology");
  await recovered.close();

  console.log(`Research Graph smoke: ok (LadybugDB ${health.engineVersion}, schema ${health.schemaVersion}, ${projection.nodes.length} nodes, ${projection.relations.length} relations)`);
} finally {
  await store?.close().catch(() => undefined);
  await rm(directory, { recursive: true, force: true });
}

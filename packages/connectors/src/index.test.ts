import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConnectorWorkflowService, FixtureConnectorAdapter, JsonConnectorJobRepository, listConnectors, preflightConnector } from "./index.js";

const base = {
  datasetId: "jplMURSST41",
  variables: ["analysed_sst"],
  region: { west: 130, east: 150, south: 10, north: 30 },
  time: { start: "2023-07-01", end: "2023-07-31" },
  outputFormat: "NetCDF" as const,
};

describe("Gate 4 ocean connector preflight", () => {
  it("exposes exactly four lazy connector descriptors", () => {
    expect(listConnectors().map((item) => item.id)).toEqual(["erddap", "argo-gdac", "copernicus-marine", "nasa-harmony"]);
  });

  it("requires metadata before presenting an ERDDAP download for approval", () => {
    const plan = preflightConnector({ ...base, connectorId: "erddap" });
    expect(plan).toMatchObject({ status: "metadata_required", approvalRisks: ["network", "write"] });
    expect(plan.metadataProbe.endpoint).toContain("/info/jplMURSST41/index.json");
    expect(plan).not.toHaveProperty("estimatedBytes");
  });

  it("uses shape metadata to create a stable volume estimate without credentials", () => {
    const first = preflightConnector({ ...base, connectorId: "argo-gdac", expectedShape: [8, 21], bytesPerValue: 8 });
    const second = preflightConnector({ ...base, connectorId: "argo-gdac", expectedShape: [8, 21], bytesPerValue: 8 });
    expect(first.status).toBe("ready");
    expect(first.estimatedBytes).toBe(1344);
    expect(first.requestHash).toBe(second.requestHash);
  });

  it("never embeds Copernicus credentials in its CLI plan", () => {
    const plan = preflightConnector({ ...base, connectorId: "copernicus-marine" });
    expect(plan.status).toBe("credentials_required");
    expect(plan.metadataProbe.argv).toEqual(["describe", "--dataset-id", "jplMURSST41", "--return-fields", "all"]);
    expect(JSON.stringify(plan)).not.toMatch(/password|username/i);
  });

  it("rejects invalid spatial requests before any network access", () => {
    expect(() => preflightConnector({ ...base, connectorId: "nasa-harmony", region: { west: 150, east: 130, south: 10, north: 30 } })).toThrow("geographic");
  });

  it("persists approval before a content-addressed download", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-connectors-"));
    const repository = new JsonConnectorJobRepository(join(root, "jobs.json"));
    const workflow = new ConnectorWorkflowService(repository, { async download() { return { uri: "artifact://sha256/abc", bytes: 1344, sha256: "a".repeat(64) }; } }, () => "2026-08-23T00:00:00.000Z");
    await workflow.initialize();
    const job = await workflow.prepare({ ...base, connectorId: "erddap" }, { selectedShape: [8, 21], bytesPerValue: 8, estimateKind: "exact", estimatedBytes: 1344, estimationMethod: "test fixture", variables: [{ name: "analysed_sst", units: "degree_Celsius" }], sourceHash: "b".repeat(64), fetchedAt: "2026-08-23T00:00:00.000Z", source: "fixture", provider: "erddap" });
    await expect(workflow.download(job.id)).rejects.toThrow("requires approval");
    await workflow.approve(job.id);
    expect((await workflow.download(job.id)).status).toBe("completed");
    const restored = new ConnectorWorkflowService(repository, { async download() { throw new Error("unused"); } });
    expect((await restored.initialize())[0]).toMatchObject({ status: "completed", artifact: { bytes: 1344 } });
  });

  it("supports explicit rejection and an offline fixture artifact without network access", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-connector-fixture-"));
    const adapter = new FixtureConnectorAdapter(join(root, "artifacts"), () => "2026-08-23T00:00:00.000Z");
    const workflow = new ConnectorWorkflowService(new JsonConnectorJobRepository(join(root, "jobs.json")), adapter);
    await workflow.initialize();
    const request = { ...base, connectorId: "erddap" as const };
    const metadata = await adapter.probe(request);
    const rejected = await workflow.prepare(request, metadata);
    expect((await workflow.reject(rejected.id)).status).toBe("rejected");
    await expect(workflow.approve(rejected.id)).rejects.toThrow("not pending");
    const accepted = await workflow.prepare(request, metadata);
    await workflow.approve(accepted.id);
    expect(await workflow.download(accepted.id)).toMatchObject({ status: "completed", artifact: { uri: expect.stringContaining("artifact://connector-fixture/") } });
  });

  it("blocks approval when an official service cannot disclose result volume", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-connector-unknown-"));
    const workflow = new ConnectorWorkflowService(new JsonConnectorJobRepository(join(root, "jobs.json")), { async download() { throw new Error("must not run"); } });
    await workflow.initialize();
    const metadata = {
      selectedShape: [], bytesPerValue: 4, variables: [{ name: "TEMP", units: "unknown" }],
      estimateKind: "unknown" as const, estimationMethod: "provider exposes no result-size estimate",
      sourceHash: "c".repeat(64), fetchedAt: "2026-08-23T00:00:00.000Z", source: "live" as const, provider: "nasa-harmony" as const,
    };
    await expect(workflow.prepare({ ...base, connectorId: "nasa-harmony" }, metadata, true)).rejects.toThrow("disclosed volume");
  });

  it("locks fixture versus live execution mode into the approval record", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-connector-mode-"));
    const observed: string[] = [];
    const workflow = new ConnectorWorkflowService(new JsonConnectorJobRepository(join(root, "jobs.json")), { async download(_request, _target, _signal, mode) { observed.push(mode ?? "missing"); return { uri: "artifact://sha256/test", bytes: 1, sha256: "d".repeat(64) }; } });
    await workflow.initialize();
    const metadata = { selectedShape: [1], bytesPerValue: 4, variables: [{ name: "analysed_sst", units: "degree_Celsius" }], estimateKind: "estimated" as const, estimatedBytes: 4, estimationMethod: "test", sourceHash: "e".repeat(64), fetchedAt: "2026-08-23T00:00:00.000Z", source: "live" as const, provider: "erddap" as const };
    const job = await workflow.prepare({ ...base, connectorId: "erddap" }, metadata);
    expect(job.executionMode).toBe("live");
    await workflow.approve(job.id); await workflow.download(job.id);
    expect(observed).toEqual(["live"]);
  });
});

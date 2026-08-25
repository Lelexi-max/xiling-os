import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { CredentialStore } from "@xiling/credentials";
import { PiMcpGatewayManager } from "@xiling/pi-runtime";
import { McpSettingsService } from "./mcp-service.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("McpSettingsService", () => {
  it("persists redacted settings and runs an offline stdio connection test", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "xiling-mcp-settings-")); roots.push(root);
    const credentials = new CredentialStore(resolve(root, "credentials"), {});
    await credentials.initialize();
    const gateway = new PiMcpGatewayManager(resolve(root, "host"));
    const service = new McpSettingsService(resolve(root, "mcp"), credentials, gateway);
    await service.initialize();
    const fixture = resolve(process.cwd(), "packages", "pi-runtime", "test-fixtures", "mcp-echo-server.mjs");
    await service.upsert({ name: "echo-lab", description: "offline fixture", keywords: ["echo"], transport: "stdio", command: process.execPath, args: [fixture], authentication: "none", access: "trusted", enabled: true });
    expect(service.list()).toMatchObject({ strategy: "proxy-lazy", isolation: "child-process", residentToolSchemas: 1, servers: [{ name: "echo-lab", runtimeState: "not-connected" }] });
    const tested = await service.test("echo-lab");
    expect(tested).toMatchObject({ ok: true, serverName: "echo-lab", state: "connected", toolCount: 1 });
    const persisted = await readFile(resolve(root, "mcp", "servers.json"), "utf8");
    expect(persisted).toContain("echo-lab");
    expect(persisted).not.toContain("bearerToken");
    await gateway.close();
  }, 30_000);
});

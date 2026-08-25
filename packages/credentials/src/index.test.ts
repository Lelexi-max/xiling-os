import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CredentialStore } from "./index.js";

describe("credential store smoke", () => {
  it("encrypts secrets, never exposes values in status, and restores them", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-credentials-"));
    const first = new CredentialStore(root, {}); await first.initialize();
    const status = await first.set("openai", { apiKey: "non-secret-fixture-key" });
    expect(status).toMatchObject({ configured: true, source: "local", configuredFields: ["apiKey"] });
    expect(JSON.stringify(status)).not.toContain("non-secret-fixture-key");
    expect(await readFile(join(root, "credentials.enc.json"), "utf8")).not.toContain("non-secret-fixture-key");
    if (process.platform !== "win32") expect((await stat(join(root, "credentials.enc.json"))).mode & 0o777).toBe(0o600);
    const restored = new CredentialStore(root, {}); await restored.initialize();
    expect(restored.get("openai", "apiKey")).toBe("non-secret-fixture-key");
    expect((await restored.clear("openai")).configured).toBe(false);
  });

  it("uses environment variables without copying them to local storage", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-credentials-env-"));
    const store = new CredentialStore(root, { COPERNICUSMARINE_SERVICE_USERNAME: "fixture-user", COPERNICUSMARINE_SERVICE_PASSWORD: "fixture-password" }); await store.initialize();
    expect(store.status("copernicus-marine")).toMatchObject({ configured: true, source: "environment" });
    expect(store.get("copernicus-marine", "password")).toBe("fixture-password");
  });

  it("stores a custom compatible endpoint as encrypted connection metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-custom-provider-"));
    const store = new CredentialStore(root, {}); await store.initialize();
    const status = await store.set("custom", { displayName: "Lab Gateway", baseUrl: "http://127.0.0.1:8000/v1", apiStyle: "openai-completions", testModel: "ocean-model", apiKey: "fixture-key" });
    expect(status).toMatchObject({ configured: true, category: "model" });
    expect(status.capabilities?.input).toEqual(["text"]);
    expect(JSON.stringify(status)).not.toContain("fixture-key");
  });
});

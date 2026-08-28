import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalArtifactStore } from "./index.js";

describe("local content-addressed Artifact store", () => {
  it("deduplicates payloads, scopes records by project and supports bounded reads", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-artifacts-"));
    const store = new LocalArtifactStore(join(root, "artifacts.sqlite"), join(root, "blobs"));
    const data = Buffer.from("0123456789");
    const first = await store.put({ projectId: "p1", name: "结果.txt", mimeType: "text/plain", kind: "document", data });
    const retried = await store.put({ projectId: "p1", name: "结果.txt", mimeType: "text/plain", kind: "document", data });
    const second = await store.put({ projectId: "p2", name: "same.txt", mimeType: "text/plain", kind: "document", data });
    expect(retried.id).toBe(first.id);
    expect(first.uri).toBe(second.uri);
    expect(first.id).not.toBe(second.id);
    expect(store.get("p2", first.id)).toBeUndefined();
    const range = await store.read("p1", first.uri, 2, 4);
    expect(Buffer.from(range.data).toString()).toBe("2345");
    expect(range.truncated).toBe(true);
    expect((await store.verify("p1", first.id))).toMatchObject({ valid: true, actualBytes: 10 });
    store.close();
  });

  it("streams imports, detects tampering and enforces lifecycle transitions", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-artifact-import-"));
    const blobs = join(root, "blobs");
    const source = join(root, "源 数据.csv");
    await writeFile(source, "a,b\n1,2\n", "utf8");
    const store = new LocalArtifactStore(join(root, "artifacts.sqlite"), blobs);
    const record = await store.importFile({ projectId: "p1", name: "源 数据.csv", mimeType: "text/csv", kind: "table", sourcePath: source, sourceUri: "dataset://external/import" });
    expect(record.sha256).toBe(createHash("sha256").update("a,b\n1,2\n").digest("hex"));
    expect(store.transition("p1", record.id, "quarantined").lifecycle).toBe("quarantined");
    expect(store.transition("p1", record.id, "available").lifecycle).toBe("available");
    expect(store.transition("p1", record.id, "archived").lifecycle).toBe("archived");
    expect(() => store.transition("p1", record.id, "available")).toThrow("Invalid Artifact lifecycle transition");
    const blob = join(blobs, record.sha256.slice(0, 2), record.sha256);
    await writeFile(blob, "tampered", "utf8");
    expect(await store.verify("p1", record.id)).toMatchObject({ valid: false });
    store.close();
  });
});

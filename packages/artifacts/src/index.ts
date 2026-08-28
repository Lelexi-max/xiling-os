import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync } from "node:fs";
import { access, mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import type { ArtifactLifecycle, ArtifactRecord, ResourceUri } from "@xiling/contracts";

export interface ArtifactPutInput {
  projectId: string;
  name: string;
  mimeType: string;
  kind: string;
  data: Uint8Array;
  producerRunId?: string;
  sourceUri?: ResourceUri | string;
}

export interface ArtifactImportInput extends Omit<ArtifactPutInput, "data"> { sourcePath: string; }
export interface ArtifactReadResult { record: ArtifactRecord; offsetBytes: number; data: Uint8Array; truncated: boolean; }
export interface ArtifactIntegrityResult { record: ArtifactRecord; valid: boolean; actualSha256: string; actualBytes: number; }

export interface ArtifactRegistry {
  put(input: ArtifactPutInput): Promise<ArtifactRecord>;
  importFile(input: ArtifactImportInput): Promise<ArtifactRecord>;
  get(projectId: string, uriOrId: string): ArtifactRecord | undefined;
  list(projectId: string): ArtifactRecord[];
  read(projectId: string, uriOrId: string, offsetBytes?: number, maxBytes?: number): Promise<ArtifactReadResult>;
  verify(projectId: string, uriOrId: string): Promise<ArtifactIntegrityResult>;
  transition(projectId: string, id: string, lifecycle: ArtifactLifecycle): ArtifactRecord;
}

const schemaVersion = 1;
const now = () => new Date().toISOString();
const artifactUri = (sha256: string) => `artifact://sha256/${sha256}` as const;
const lifecycleTransitions: Record<ArtifactLifecycle, ReadonlySet<ArtifactLifecycle>> = {
  staging: new Set(["available", "quarantined"]),
  available: new Set(["quarantined", "archived"]),
  quarantined: new Set(["available", "archived"]),
  archived: new Set(),
};

function rowToRecord(row: Record<string, unknown>): ArtifactRecord {
  const optional = (value: unknown) => typeof value === "string" && value ? value : undefined;
  const producerRunId = optional(row.producer_run_id);
  const sourceUri = optional(row.source_uri);
  const verifiedAt = optional(row.verified_at);
  return {
    id: String(row.id), projectId: String(row.project_id), uri: String(row.uri) as ArtifactRecord["uri"],
    sha256: String(row.sha256), bytes: Number(row.bytes), mimeType: String(row.mime_type), name: String(row.name),
    kind: String(row.kind), lifecycle: String(row.lifecycle) as ArtifactLifecycle,
    ...(producerRunId ? { producerRunId } : {}), ...(sourceUri ? { sourceUri } : {}), createdAt: String(row.created_at),
    ...(verifiedAt ? { verifiedAt } : {}),
  };
}

function validateDescriptor(input: Omit<ArtifactPutInput, "data">): void {
  if (!input.projectId.trim()) throw new Error("Artifact requires a projectId");
  if (!input.name.trim() || input.name.length > 500) throw new Error("Artifact name is invalid");
  if (!/^[\w.+-]+\/[\w.+-]+$/u.test(input.mimeType)) throw new Error("Artifact MIME type is invalid");
  if (!/^[a-z0-9][a-z0-9._:/-]{1,159}$/i.test(input.kind)) throw new Error("Artifact kind is invalid");
}

export class LocalArtifactStore implements ArtifactRegistry {
  private readonly database: DatabaseSync;
  private readonly blobRoot: string;

  constructor(databasePath: string, blobRoot: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    mkdirSync(blobRoot, { recursive: true });
    this.blobRoot = resolve(blobRoot);
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  close(): void { this.database.close(); }

  async put(input: ArtifactPutInput): Promise<ArtifactRecord> {
    validateDescriptor(input);
    const data = Buffer.from(input.data);
    const sha256 = createHash("sha256").update(data).digest("hex");
    const destination = this.blobPath(sha256);
    await mkdir(dirname(destination), { recursive: true });
    try { await access(destination); }
    catch {
      const temporary = `${destination}.${randomUUID()}.tmp`;
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
      try { await rename(temporary, destination); }
      catch (error) { await rm(temporary, { force: true }); try { await access(destination); } catch { throw error; } }
    }
    return this.insertRecord(input, sha256, data.byteLength);
  }

  async importFile(input: ArtifactImportInput): Promise<ArtifactRecord> {
    validateDescriptor(input);
    const staging = resolve(this.blobRoot, ".staging", `${randomUUID()}.tmp`);
    await mkdir(dirname(staging), { recursive: true });
    const digest = createHash("sha256");
    let bytes = 0;
    const observer = new Transform({ transform(chunk: Buffer, _encoding, callback) { digest.update(chunk); bytes += chunk.byteLength; callback(null, chunk); } });
    try {
      await pipeline(createReadStream(input.sourcePath), observer, createWriteStream(staging, { flags: "wx", mode: 0o600 }));
      const sha256 = digest.digest("hex");
      const destination = this.blobPath(sha256);
      await mkdir(dirname(destination), { recursive: true });
      try { await access(destination); await rm(staging, { force: true }); } catch { await rename(staging, destination); }
      return this.insertRecord(input, sha256, bytes);
    } catch (error) { await rm(staging, { force: true }); throw error; }
  }

  get(projectId: string, uriOrId: string): ArtifactRecord | undefined {
    const row = this.database.prepare("SELECT * FROM artifacts WHERE project_id = ? AND (id = ? OR uri = ?)").get(projectId, uriOrId, uriOrId) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  list(projectId: string): ArtifactRecord[] {
    return (this.database.prepare("SELECT * FROM artifacts WHERE project_id = ? ORDER BY created_at DESC, id DESC").all(projectId) as Record<string, unknown>[]).map(rowToRecord);
  }

  async read(projectId: string, uriOrId: string, offsetBytes = 0, maxBytes = 64 * 1024): Promise<ArtifactReadResult> {
    const record = this.get(projectId, uriOrId);
    if (!record) throw new Error("Artifact not found in project");
    if (!Number.isSafeInteger(offsetBytes) || offsetBytes < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 4 * 1024 * 1024) throw new Error("Artifact read range is invalid");
    const handle = await open(this.blobPath(record.sha256), "r");
    try {
      const stat = await handle.stat();
      const length = Math.min(maxBytes, Math.max(0, stat.size - offsetBytes));
      const data = Buffer.alloc(length);
      const { bytesRead } = await handle.read(data, 0, length, offsetBytes);
      return { record, offsetBytes, data: data.subarray(0, bytesRead), truncated: offsetBytes + bytesRead < stat.size };
    } finally { await handle.close(); }
  }

  async verify(projectId: string, uriOrId: string): Promise<ArtifactIntegrityResult> {
    const record = this.get(projectId, uriOrId);
    if (!record) throw new Error("Artifact not found in project");
    const digest = createHash("sha256");
    let bytes = 0;
    for await (const chunk of createReadStream(this.blobPath(record.sha256))) { const data = Buffer.from(chunk); digest.update(data); bytes += data.byteLength; }
    const actualSha256 = digest.digest("hex");
    const valid = actualSha256 === record.sha256 && bytes === record.bytes;
    if (valid) this.database.prepare("UPDATE artifacts SET verified_at = ? WHERE id = ? AND project_id = ?").run(now(), record.id, projectId);
    return { record: this.get(projectId, record.id)!, valid, actualSha256, actualBytes: bytes };
  }

  transition(projectId: string, id: string, lifecycle: ArtifactLifecycle): ArtifactRecord {
    const record = this.get(projectId, id);
    if (!record) throw new Error("Artifact not found in project");
    if (record.lifecycle !== lifecycle && !lifecycleTransitions[record.lifecycle]?.has(lifecycle)) throw new Error(`Invalid Artifact lifecycle transition: ${record.lifecycle} -> ${lifecycle}`);
    this.database.prepare("UPDATE artifacts SET lifecycle = ? WHERE id = ? AND project_id = ?").run(lifecycle, id, projectId);
    return this.get(projectId, id)!;
  }

  private insertRecord(input: Omit<ArtifactPutInput, "data">, sha256: string, bytes: number): ArtifactRecord {
    const existing = this.database.prepare(`SELECT * FROM artifacts WHERE project_id = ? AND sha256 = ? AND name = ? AND kind = ? AND producer_run_id IS ? AND source_uri IS ? AND lifecycle != 'archived' ORDER BY created_at DESC LIMIT 1`).get(input.projectId, sha256, input.name, input.kind, input.producerRunId ?? null, input.sourceUri ?? null) as Record<string, unknown> | undefined;
    if (existing) return rowToRecord(existing);
    const id = randomUUID();
    const createdAt = now();
    this.database.prepare(`INSERT INTO artifacts
      (id, project_id, uri, sha256, bytes, mime_type, name, kind, lifecycle, producer_run_id, source_uri, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, ?)`)
      .run(id, input.projectId, artifactUri(sha256), sha256, bytes, input.mimeType, input.name, input.kind, input.producerRunId ?? null, input.sourceUri ?? null, createdAt);
    return this.get(input.projectId, id)!;
  }

  private blobPath(sha256: string): string {
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Artifact hash is invalid");
    const path = resolve(this.blobRoot, sha256.slice(0, 2), sha256);
    if (!path.startsWith(`${this.blobRoot}${sep}`)) throw new Error("Artifact path escapes Blob Store");
    return path;
  }

  private migrate(): void {
    const current = (this.database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (current > schemaVersion) throw new Error(`Artifact database version ${current} is newer than supported ${schemaVersion}`);
    if (current === schemaVersion) return;
    this.database.exec(`BEGIN IMMEDIATE;
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, uri TEXT NOT NULL, sha256 TEXT NOT NULL,
        bytes INTEGER NOT NULL, mime_type TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
        lifecycle TEXT NOT NULL, producer_run_id TEXT, source_uri TEXT, created_at TEXT NOT NULL, verified_at TEXT
      );
      CREATE INDEX artifacts_project_created ON artifacts(project_id, created_at DESC);
      CREATE INDEX artifacts_sha256 ON artifacts(sha256);
      PRAGMA user_version = 1;
      COMMIT;`);
  }
}

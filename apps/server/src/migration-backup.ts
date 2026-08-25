import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const BACKUP_FORMAT_VERSION = 1 as const;
const BACKUP_GATE = "4.5-C" as const;
const SQLITE_FILES = ["knowledge.sqlite", "agent-center.sqlite"] as const;

export interface Gate45CMigrationBackupDatabase {
  sourceFile: (typeof SQLITE_FILES)[number];
  backupFile: (typeof SQLITE_FILES)[number];
  bytes: number;
  sha256: string;
  integrityCheck: "ok";
}

export interface Gate45CMigrationBackupManifest {
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  gate: typeof BACKUP_GATE;
  backupId: string;
  createdAt: string;
  directory: string;
  sourceRoot: string;
  method: "sqlite-vacuum-into";
  databases: Gate45CMigrationBackupDatabase[];
  skipped: Array<(typeof SQLITE_FILES)[number]>;
}

export interface Gate45CMigrationBackupOptions {
  gate4Root: string;
  backupRoot?: string;
  now?: () => Date;
  uniqueId?: () => string;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function safeDirectoryPart(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!safe) throw new Error("Migration backup unique ID must contain a letter or number");
  return safe;
}

function timestampDirectoryPart(createdAt: string): string {
  return createdAt.replace(/[-:]/g, "").replace(".", "-");
}

function verifyBackup(path: string): "ok" {
  const sqlite = new DatabaseSync(path, { readOnly: true, timeout: 5_000 });
  try {
    const result = sqlite.prepare("PRAGMA integrity_check").get() as Record<string, unknown> | undefined;
    if (!result || Object.values(result)[0] !== "ok") throw new Error(`SQLite integrity check failed for ${basename(path)}`);
    return "ok";
  } finally {
    sqlite.close();
  }
}

function backupDatabase(sourcePath: string, destinationPath: string): Gate45CMigrationBackupDatabase {
  const sqlite = new DatabaseSync(sourcePath, { readOnly: true, timeout: 5_000 });
  try {
    // VACUUM INTO uses SQLite's snapshot semantics, so committed pages still in a
    // WAL are included without copying transient -wal/-shm sidecars.
    sqlite.exec(`VACUUM main INTO ${sqlString(destinationPath)}`);
  } finally {
    sqlite.close();
  }

  const sourceFile = basename(sourcePath) as Gate45CMigrationBackupDatabase["sourceFile"];
  return {
    sourceFile,
    backupFile: sourceFile,
    bytes: statSync(destinationPath).size,
    sha256: createHash("sha256").update(readFileSync(destinationPath)).digest("hex"),
    integrityCheck: verifyBackup(destinationPath),
  };
}

/**
 * Creates a point-in-time, non-overwriting backup for the Gate 4.5-C migration.
 * A directory becomes visible under its final name only after every included
 * database has passed SQLite's integrity check and the manifest is durable.
 */
export function createGate45CMigrationBackup(options: Gate45CMigrationBackupOptions): Gate45CMigrationBackupManifest {
  const gate4Root = resolve(options.gate4Root);
  const backupRoot = options.backupRoot ? resolve(options.backupRoot) : resolve(gate4Root, "migration-backups");
  const createdAt = (options.now ?? (() => new Date()))().toISOString();
  const uniqueId = safeDirectoryPart((options.uniqueId ?? randomUUID)());
  const backupId = `gate-4.5-c-${timestampDirectoryPart(createdAt)}-${uniqueId}`;
  const finalDirectory = resolve(backupRoot, backupId);
  const stagingDirectory = resolve(backupRoot, `.${backupId}.incomplete`);

  mkdirSync(backupRoot, { recursive: true });
  if (existsSync(finalDirectory) || existsSync(stagingDirectory)) throw new Error(`Migration backup already exists: ${backupId}`);
  mkdirSync(stagingDirectory);

  let published = false;
  try {
    const databases: Gate45CMigrationBackupDatabase[] = [];
    const skipped: Gate45CMigrationBackupManifest["skipped"] = [];
    for (const sourceFile of SQLITE_FILES) {
      const sourcePath = resolve(gate4Root, sourceFile);
      if (!existsSync(sourcePath)) {
        skipped.push(sourceFile);
        continue;
      }
      databases.push(backupDatabase(sourcePath, resolve(stagingDirectory, sourceFile)));
    }

    const manifest: Gate45CMigrationBackupManifest = {
      formatVersion: BACKUP_FORMAT_VERSION,
      gate: BACKUP_GATE,
      backupId,
      createdAt,
      directory: finalDirectory,
      sourceRoot: gate4Root,
      method: "sqlite-vacuum-into",
      databases,
      skipped,
    };
    writeFileSync(resolve(stagingDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(stagingDirectory, finalDirectory);
    published = true;
    return manifest;
  } finally {
    if (!published && existsSync(stagingDirectory)) rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

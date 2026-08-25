import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createGate45CMigrationBackup } from "./migration-backup.js";

function openWalFixture(path: string, value: string): DatabaseSync {
  const sqlite = new DatabaseSync(path);
  sqlite.exec("PRAGMA journal_mode=WAL; CREATE TABLE records (value TEXT NOT NULL)");
  sqlite.prepare("INSERT INTO records (value) VALUES (?)").run(value);
  return sqlite;
}

function readFixture(path: string): string {
  const sqlite = new DatabaseSync(path, { readOnly: true });
  try {
    return (sqlite.prepare("SELECT value FROM records").get() as { value: string }).value;
  } finally {
    sqlite.close();
  }
}

describe("Gate 4.5-C migration backup", () => {
  it("backs up WAL-backed databases consistently and publishes an immutable manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-migration-backup-"));
    const gate4Root = join(root, "研究者's data", "含 空格", "gate4");
    await mkdir(gate4Root, { recursive: true });
    const knowledge = openWalFixture(join(gate4Root, "knowledge.sqlite"), "knowledge-in-wal");
    const agentCenter = openWalFixture(join(gate4Root, "agent-center.sqlite"), "agent-in-wal");

    try {
      const manifest = createGate45CMigrationBackup({
        gate4Root,
        now: () => new Date("2026-08-24T01:02:03.456Z"),
        uniqueId: () => "fixed-id",
      });

      expect(manifest.backupId).toBe("gate-4.5-c-20260824T010203-456Z-fixed-id");
      expect(manifest.databases.map((database) => database.sourceFile)).toEqual(["knowledge.sqlite", "agent-center.sqlite"]);
      expect(manifest.databases.every((database) => database.integrityCheck === "ok" && database.sha256.length === 64)).toBe(true);
      expect(readFixture(join(manifest.directory, "knowledge.sqlite"))).toBe("knowledge-in-wal");
      expect(readFixture(join(manifest.directory, "agent-center.sqlite"))).toBe("agent-in-wal");
      expect(JSON.parse(await readFile(join(manifest.directory, "manifest.json"), "utf8"))).toEqual(manifest);
      expect((await readdir(join(gate4Root, "migration-backups"))).some((name) => name.includes("incomplete"))).toBe(false);
    } finally {
      knowledge.close();
      agentCenter.close();
    }
  });

  it("never overwrites an old backup and records missing databases", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-migration-unique-"));
    const gate4Root = join(root, "gate4");
    const backupRoot = join(root, "backups");
    await mkdir(gate4Root, { recursive: true });
    const knowledge = openWalFixture(join(gate4Root, "knowledge.sqlite"), "one database only");

    try {
      const first = createGate45CMigrationBackup({ gate4Root, backupRoot, now: () => new Date(0), uniqueId: () => "one" });
      const second = createGate45CMigrationBackup({ gate4Root, backupRoot, now: () => new Date(0), uniqueId: () => "two" });
      expect(first.directory).not.toBe(second.directory);
      expect(first.createdAt).toBe(second.createdAt);
      expect(first.skipped).toEqual(["agent-center.sqlite"]);
      expect(second.skipped).toEqual(["agent-center.sqlite"]);
      expect(readFixture(join(first.directory, "knowledge.sqlite"))).toBe("one database only");
      expect(readFixture(join(second.directory, "knowledge.sqlite"))).toBe("one database only");
      expect(() => createGate45CMigrationBackup({ gate4Root, backupRoot, now: () => new Date(0), uniqueId: () => "one" })).toThrow(/already exists/);
      expect(readFixture(join(first.directory, "knowledge.sqlite"))).toBe("one database only");
    } finally {
      knowledge.close();
    }
  });

  it("removes only its incomplete directory when a later database fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiling-migration-cleanup-"));
    const gate4Root = join(root, "gate4");
    const backupRoot = join(root, "backups");
    const oldBackup = join(backupRoot, "gate-4.5-c-old");
    await mkdir(gate4Root, { recursive: true });
    await mkdir(oldBackup, { recursive: true });
    await writeFile(join(oldBackup, "keep.txt"), "keep", "utf8");
    const knowledge = openWalFixture(join(gate4Root, "knowledge.sqlite"), "valid first database");
    await writeFile(join(gate4Root, "agent-center.sqlite"), "not a sqlite database", "utf8");

    try {
      expect(() => createGate45CMigrationBackup({ gate4Root, backupRoot, uniqueId: () => "will-fail" })).toThrow();
      expect(await readdir(backupRoot)).toEqual(["gate-4.5-c-old"]);
      expect(await readFile(join(oldBackup, "keep.txt"), "utf8")).toBe("keep");
    } finally {
      knowledge.close();
    }
  });
});

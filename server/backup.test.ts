import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupBeforeImport, runDailyBackup } from "./backup.ts";
import type { DB } from "./db.ts";
import { openDatabase } from "./db.ts";

describe("backups", () => {
  let dataDir: string;
  let db: Kysely<DB>;
  const backupsDir = () => join(dataDir, "backups");
  const backupFiles = () => (existsSync(backupsDir()) ? readdirSync(backupsDir()).sort() : []);

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-backup-"));
    db = await openDatabase(dataDir);
  });
  afterEach(async () => {
    await db.destroy();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("makes one backup per day, however often it runs", async () => {
    const first = await runDailyBackup(db, dataDir, "2026-05-01");
    const second = await runDailyBackup(db, dataDir, "2026-05-01");
    expect(first.created).toBe("gbi-2026-05-01.sqlite");
    expect(second.created).toBeUndefined();
    expect(backupFiles()).toEqual(["gbi-2026-05-01.sqlite"]);
  });

  it("writes a copy that opens as a database with the data in it", async () => {
    await db
      .insertInto("goal")
      .values({
        id: "g1",
        name: "Home",
        priority: "Need",
        targetCents: 5_000_000,
        targetYear: 2032,
        contributionGrowth: 0.02,
        minProb: null,
        countsTowardFi: 0,
      })
      .execute();
    await runDailyBackup(db, dataDir, "2026-05-01");
    const copy = new DatabaseSync(join(backupsDir(), "gbi-2026-05-01.sqlite"));
    try {
      expect(copy.prepare("SELECT name FROM goal").all()).toEqual([{ name: "Home" }]);
    } finally {
      copy.close();
    }
  });

  it("keeps 30 files after a start on the next day, deleting the oldest", async () => {
    mkdirSync(backupsDir());
    const old = Array.from(
      { length: 30 },
      (_, i) => `gbi-2026-04-${String(i + 1).padStart(2, "0")}.sqlite`,
    );
    for (const name of old) writeFileSync(join(backupsDir(), name), "x");

    const result = await runDailyBackup(db, dataDir, "2026-05-01");

    expect(result.created).toBe("gbi-2026-05-01.sqlite");
    expect(result.pruned).toEqual(["gbi-2026-04-01.sqlite"]);
    const files = backupFiles();
    expect(files).toHaveLength(30);
    expect(files).toContain("gbi-2026-05-01.sqlite");
    expect(files).not.toContain("gbi-2026-04-01.sqlite");
  });

  it("never touches a file that does not match the backup name", async () => {
    mkdirSync(backupsDir());
    const others = ["notes.txt", "gbi-latest.sqlite", "gbi-2026-04-01.sqlite.bak", "readme"];
    for (const name of others) writeFileSync(join(backupsDir(), name), "x");
    for (let i = 1; i <= 30; i++) {
      writeFileSync(join(backupsDir(), `gbi-2026-04-${String(i).padStart(2, "0")}.sqlite`), "x");
    }

    await runDailyBackup(db, dataDir, "2026-05-01");

    for (const name of others) expect(backupFiles()).toContain(name);
  });

  it("keeps the backup it just wrote when the app clock is behind the newest backups", async () => {
    mkdirSync(backupsDir());
    for (let i = 1; i <= 30; i++) {
      writeFileSync(join(backupsDir(), `gbi-2026-06-${String(i).padStart(2, "0")}.sqlite`), "x");
    }

    const result = await runDailyBackup(db, dataDir, "2026-05-01");

    expect(result.created).toBe("gbi-2026-05-01.sqlite");
    expect(backupFiles()).toContain("gbi-2026-05-01.sqlite");
    expect(backupFiles()).toHaveLength(30);
    expect(result.pruned).toEqual(["gbi-2026-06-01.sqlite"]);
  });

  it("makes a pre-import backup under its own name, outside the once-a-day rule", async () => {
    const before = await backupBeforeImport(db, dataDir, "2026-05-01");
    const daily = await runDailyBackup(db, dataDir, "2026-05-01");
    expect(before).toMatch(/^gbi-2026-05-01-import-\d+\.sqlite$/);
    expect(daily.created).toBe("gbi-2026-05-01.sqlite");
    expect(backupFiles()).toHaveLength(2);
  });

  it("prunes pre-import backups with the same 30-file limit", async () => {
    mkdirSync(backupsDir());
    for (let i = 1; i <= 30; i++) {
      writeFileSync(join(backupsDir(), `gbi-2026-04-${String(i).padStart(2, "0")}.sqlite`), "x");
    }
    await backupBeforeImport(db, dataDir, "2026-05-01");
    expect(backupFiles()).toHaveLength(30);
    expect(backupFiles()).not.toContain("gbi-2026-04-01.sqlite");
  });
});

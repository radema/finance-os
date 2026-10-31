import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { DB } from "./db.ts";

/** Backups kept in `<data>/backups/`; older ones are deleted. */
export const BACKUPS_KEPT = 30;

const BACKUPS_FOLDER = "backups";
// `gbi-<day>.sqlite` is the daily backup; `gbi-<day>-import-<ms>.sqlite` is taken before an import.
const BACKUP_NAME = /^gbi-\d{4}-\d{2}-\d{2}(-import-\d+)?\.sqlite$/;

export interface BackupResult {
  /** File name of the new backup; undefined when today's backup already existed. */
  created: string | undefined;
  /** File names deleted to stay at the limit. */
  pruned: string[];
}

const backupNames = (dir: string): string[] => readdirSync(dir).filter((n) => BACKUP_NAME.test(n));

/** Writes a consistent copy of the database into the backups folder, then prunes. */
async function writeBackup(
  db: Kysely<DB>,
  dataDir: string,
  name: string,
): Promise<{ created: string; pruned: string[] }> {
  const dir = join(dataDir, BACKUPS_FOLDER);
  mkdirSync(dir, { recursive: true });
  await sql`VACUUM INTO ${join(dir, name)}`.execute(db);
  // Names sort by day; on one day the `-import-` names come before the daily name. The file just
  // written stays, even when the app clock is behind the others, and the 29 newest others stay too.
  const others = backupNames(dir)
    .filter((existing) => existing !== name)
    .sort()
    .reverse();
  const pruned = others.slice(BACKUPS_KEPT - 1);
  for (const old of pruned) rmSync(join(dir, old));
  return { created: name, pruned };
}

/**
 * Backs up the database with `VACUUM INTO`, at most once a day, and keeps the 30 newest backups.
 *
 * @param db Database handle.
 * @param dataDir Data folder; backups go in its `backups/` subfolder.
 * @param today The app clock, `YYYY-MM-DD`.
 */
export async function runDailyBackup(
  db: Kysely<DB>,
  dataDir: string,
  today: string,
): Promise<BackupResult> {
  const name = `gbi-${today}.sqlite`;
  const dir = join(dataDir, BACKUPS_FOLDER);
  mkdirSync(dir, { recursive: true });
  if (backupNames(dir).includes(name)) return { created: undefined, pruned: [] };
  return writeBackup(db, dataDir, name);
}

/**
 * Backs up the database before an import. It has its own name, so it does not count as the daily
 * backup, and the same 30-file limit applies.
 *
 * @returns The file name of the backup.
 */
export async function backupBeforeImport(
  db: Kysely<DB>,
  dataDir: string,
  today: string,
): Promise<string> {
  const { created } = await writeBackup(db, dataDir, `gbi-${today}-import-${Date.now()}.sqlite`);
  return created;
}

import type { Kysely } from "kysely";
import { z } from "zod";
import { isCloudSyncedPath } from "./dataFolder.ts";
import type { DB } from "./db.ts";
import { exportAll, exportSchema, importAll } from "./exchange.ts";
import type { Router } from "./router.ts";

/**
 * Routes for the data folder: the JSON export and import, and where the data lives.
 *
 * @param dataDir The data folder.
 * @param today The app clock, read on each import for the backup name.
 */
export function registerDataRoutes(
  router: Router,
  db: Kysely<DB>,
  dataDir: string,
  today: () => string,
): void {
  router.route("GET", "/api/data/export", z.object({}), () => exportAll(db));
  router.route("POST", "/api/data/import", exportSchema, async (document) => {
    await importAll(db, dataDir, today(), document);
    return { status: "imported" };
  });
  router.route("GET", "/api/data/folder", z.object({}), () => ({
    path: dataDir,
    cloudSynced: isCloudSyncedPath(dataDir),
  }));
}

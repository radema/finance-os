import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import type { PriceProvider } from "../engine/priceFetch.ts";
import { registerAllocationRoutes } from "./allocation.ts";
import { registerAssumptionRoutes } from "./assumptions.ts";
import { runDailyBackup } from "./backup.ts";
import { registerCashFlowRoutes } from "./cashFlow.ts";
import { resolveToday } from "./config.ts";
import { registerDataRoutes } from "./data.ts";
import { isCloudSyncedPath } from "./dataFolder.ts";
import { openDatabase } from "./db.ts";
import { registerGoalRoutes } from "./goals.ts";
import { registerGoalViewRoutes } from "./goalViews.ts";
import { registerImportRoutes } from "./importRoutes.ts";
import { registerIndependenceRoutes } from "./independence.ts";
import { registerMonthlyJobRoutes } from "./monthlyJob.ts";
import { registerOpeningPositionRoutes } from "./openingPosition.ts";
import { registerPensionRoutes } from "./pension.ts";
import { registerPriceFetchRoutes } from "./priceFetch.ts";
import { registerPriceRoutes } from "./prices.ts";
import { registerProductRoutes } from "./products.ts";
import { createRouter } from "./router.ts";
import { registerSampleRoutes } from "./sample.ts";
import { registerSetupProgressRoutes } from "./setupProgress.ts";
import { registerSnapshotRoutes } from "./snapshots.ts";
import { serveStatic } from "./static.ts";
import { registerTransactionRoutes } from "./transactions.ts";
import { createYahooProvider } from "./yahooProvider.ts";

const HOST = "127.0.0.1";

export interface ServerOptions {
  /** Folder for the SQLite file. */
  dataDir: string;
  /** TCP port; 0 picks a free one. */
  port: number;
  /** Folder with the built web page, served outside `/api`. Omit to serve the API only. */
  webDir?: string;
  /** The app clock, `YYYY-MM-DD`. Defaults to `GBI_AS_OF`, or today. */
  today?: string;
  /** Where fetched prices come from. Defaults to Yahoo; tests pass a stub. */
  priceProvider?: PriceProvider;
}

export interface RunningServer {
  /** The address the listener is bound to. */
  address: string;
  url: string;
  close(): Promise<void>;
}

/**
 * Opens the database, applies migrations and starts the HTTP server on 127.0.0.1.
 *
 * @returns The server URL and a `close` that stops the listener and the database.
 */
export async function startServer({
  dataDir,
  port,
  webDir,
  today,
  priceProvider = createYahooProvider(),
}: ServerOptions): Promise<RunningServer> {
  const db = await openDatabase(dataDir);
  // The clock is read on each use, so an app left open overnight still knows the date.
  const clock = () => today ?? resolveToday(process.env);
  // A failed backup is logged and does not stop the app.
  await runDailyBackup(db, dataDir, clock()).catch((error: unknown) =>
    console.error("Backup failed:", error),
  );
  if (isCloudSyncedPath(dataDir)) {
    console.warn(
      `Warning: the data folder ${dataDir} is in a cloud-synced folder. Sync can corrupt the database. Move it with GBI_DATA_DIR.`,
    );
  }
  const router = createRouter();
  router.route("GET", "/api/health", z.object({}), () => ({ status: "ok" }));
  registerProductRoutes(router, db);
  registerGoalRoutes(router, db);
  registerAllocationRoutes(router, db);
  registerAssumptionRoutes(router, db);
  registerSampleRoutes(router, db);
  registerTransactionRoutes(router, db, clock);
  registerOpeningPositionRoutes(router, db);
  registerImportRoutes(router, db);
  registerPriceRoutes(router, db, clock);
  registerPriceFetchRoutes(router, db, clock, priceProvider);
  registerDataRoutes(router, db, dataDir, clock);
  registerGoalViewRoutes(router, db, clock);
  registerCashFlowRoutes(router, db, clock);
  registerPensionRoutes(router, db, clock);
  registerIndependenceRoutes(router, db, clock);
  registerSetupProgressRoutes(router, db);
  registerSnapshotRoutes(router, db, clock);
  const monthlyJob = registerMonthlyJobRoutes(router, { db, provider: priceProvider, clock });

  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const method = req.method ?? "GET";
    const request = new Request(new URL(req.url ?? "/", `http://${HOST}`), {
      method,
      body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks),
    });
    const { pathname } = new URL(request.url);
    const response =
      webDir && !pathname.startsWith("/api/")
        ? await serveStatic(webDir, pathname)
        : await router.handle(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, HOST, resolve);
    });
  } catch (error) {
    await db.destroy();
    throw error;
  }

  // On the first start of a new month: prices, then the snapshot. Not awaited: a slow provider must
  // not hold the app back.
  const startupJob = monthlyJob
    .startup()
    .catch((error: unknown) => console.error("Monthly job failed:", error));

  const bound = server.address() as AddressInfo;
  return {
    address: bound.address,
    url: `http://${bound.address}:${bound.port}`,
    async close() {
      await startupJob;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      await db.destroy();
    },
  };
}

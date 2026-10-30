import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { openDatabase } from "./db.ts";
import { createRouter } from "./router.ts";
import { serveStatic } from "./static.ts";

const HOST = "127.0.0.1";

export interface ServerOptions {
  /** Folder for the SQLite file. */
  dataDir: string;
  /** TCP port; 0 picks a free one. */
  port: number;
  /** Folder with the built web page, served outside `/api`. Omit to serve the API only. */
  webDir?: string;
}

export interface RunningServer {
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
}: ServerOptions): Promise<RunningServer> {
  const db = await openDatabase(dataDir);
  const router = createRouter();
  router.route("GET", "/api/health", z.object({}), () => ({ status: "ok" }));

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

  return {
    url: `http://${HOST}:${(server.address() as AddressInfo).port}`,
    async close() {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      await db.destroy();
    },
  };
}

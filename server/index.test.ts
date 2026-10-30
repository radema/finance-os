import { mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer } from "./index.ts";

describe("startServer", () => {
  let dataDir: string;
  let close: (() => Promise<void>) | undefined;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-server-"));
  });
  afterEach(async () => {
    await close?.();
    close = undefined;
    rmSync(dataDir, { recursive: true, force: true });
  });

  const start = async () => {
    const server = await startServer({ dataDir, port: 0 });
    close = server.close;
    return server;
  };

  it("answers /api/health with 200", async () => {
    const { url } = await start();
    const response = await fetch(`${url}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("listens on 127.0.0.1 only", async () => {
    const { url } = await start();
    const { hostname, port } = new URL(url);
    expect(hostname).toBe("127.0.0.1");

    const reach = (host: string) =>
      new Promise<boolean>((resolve) => {
        const socket = connect({ host, port: Number(port) });
        socket.on("connect", () => {
          socket.destroy();
          resolve(true);
        });
        socket.on("error", () => resolve(false));
      });
    expect(await reach("127.0.0.1")).toBe(true);
    // Another loopback address: reachable only when the server is bound to every interface.
    expect(await reach("127.0.0.2")).toBe(false);
  });

  it("creates the SQLite file in the data folder with the migration applied", async () => {
    await start();
    const db = new DatabaseSync(join(dataDir, "gbi.sqlite"));
    try {
      const migrations = db.prepare("SELECT name FROM kysely_migration ORDER BY name").all();
      expect(migrations).toEqual([{ name: "001-baseline" }]);
      const tables = db.prepare("SELECT name FROM sqlite_schema WHERE name = 'meta'").all();
      expect(tables).toEqual([{ name: "meta" }]);
      expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    } finally {
      db.close();
    }
  });

  it("creates the data folder when it is missing", async () => {
    const missing = join(dataDir, "nested", "gbi");
    const server = await startServer({ dataDir: missing, port: 0 });
    close = server.close;
    expect((await fetch(`${server.url}/api/health`)).status).toBe(200);
  });

  it("answers 404 for an unknown path", async () => {
    const { url } = await start();
    expect((await fetch(`${url}/api/nope`)).status).toBe(404);
  });
});

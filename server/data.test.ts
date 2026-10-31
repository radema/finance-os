import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer } from "./index.ts";

describe("data folder at start and over the API", () => {
  let root: string;
  let dataDir: string;
  const running: (() => Promise<void>)[] = [];
  const backups = () =>
    existsSync(join(dataDir, "backups")) ? readdirSync(join(dataDir, "backups")).sort() : [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "gbi-data-"));
    dataDir = join(root, "gbi");
  });
  afterEach(async () => {
    for (const close of running.splice(0)) await close();
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  const start = async (today: string, dir = dataDir) => {
    const server = await startServer({ dataDir: dir, port: 0, today });
    running.push(server.close);
    return server;
  };
  const stop = async (index: number) => {
    const [close] = running.splice(index, 1);
    await close?.();
  };

  it("starting twice on one day makes one backup (AC-41)", async () => {
    await start("2026-05-01");
    await stop(0);
    await start("2026-05-01");
    expect(backups()).toEqual(["gbi-2026-05-01.sqlite"]);
  });

  it("with 30 backups present, a start on the next day makes one and keeps 30 (AC-41)", async () => {
    mkdirSync(join(dataDir, "backups"), { recursive: true });
    for (let i = 1; i <= 30; i++) {
      writeFileSync(
        join(dataDir, "backups", `gbi-2026-04-${String(i).padStart(2, "0")}.sqlite`),
        "x",
      );
    }
    await start("2026-05-01");
    expect(backups()).toHaveLength(30);
    expect(backups()).toContain("gbi-2026-05-01.sqlite");
  });

  it("warns in the log and in the status when the folder is cloud-synced (AC-41)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const synced = join(root, "Library", "Mobile Documents", "com~apple~CloudDocs", "gbi");
    const { url } = await start("2026-05-01", synced);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("cloud-synced"));
    const status = await (await fetch(`${url}/api/data/folder`)).json();
    expect(status).toEqual({ path: synced, cloudSynced: true });
  });

  it("shows no warning for a normal folder (AC-41)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { url } = await start("2026-05-01");

    expect(warn).not.toHaveBeenCalled();
    const status = await (await fetch(`${url}/api/data/folder`)).json();
    expect(status).toEqual({ path: dataDir, cloudSynced: false });
  });

  it("exports, then imports into a fresh folder, over HTTP (AC-40)", async () => {
    const { url } = await start("2026-05-01");
    await fetch(`${url}/api/goals`, {
      method: "POST",
      body: JSON.stringify({
        name: "Home",
        priority: "Need",
        targetCents: 5_000_000,
        targetYear: 2032,
        contributionGrowth: 0.02,
      }),
    });
    const exported = await (await fetch(`${url}/api/data/export`)).text();
    expect(JSON.parse(exported).tables.goal).toHaveLength(1);

    const other = await start("2026-05-01", join(root, "other"));
    const imported = await fetch(`${other.url}/api/data/import`, {
      method: "POST",
      body: exported,
    });
    expect(imported.status).toBe(200);
    expect(await (await fetch(`${other.url}/api/data/export`)).text()).toBe(exported);
  });

  it("answers 400 with a message for a file that is not an export", async () => {
    const { url } = await start("2026-05-01");
    const response = await fetch(`${url}/api/data/import`, {
      method: "POST",
      body: JSON.stringify({ hello: "world" }),
    });
    expect(response.status).toBe(400);
  });

  it("answers 400 and keeps the data for a file from another migration version", async () => {
    const { url } = await start("2026-05-01");
    const exported = JSON.parse(await (await fetch(`${url}/api/data/export`)).text());
    const response = await fetch(`${url}/api/data/import`, {
      method: "POST",
      body: JSON.stringify({ ...exported, schemaVersion: "009-other" }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("009-other");
  });
});

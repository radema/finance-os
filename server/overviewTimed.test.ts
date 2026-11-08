import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { OverviewView } from "../engine/overviewView.ts";
import { openDatabase } from "./db.ts";
import { startServer } from "./index.ts";
import { monthlySample } from "./monthlyFixture.ts";
import { loadSampleData } from "./sample.ts";
import { ensureSnapshots } from "./snapshots.ts";

const TODAY = "2026-10-31";
const READY_MS = 2000; // AC-77: page ready in under 2 s
const WARM_UP_TIMEOUT_MS = 120_000;

let dataDir: string;
let stop: (() => Promise<void>) | undefined;
let url: string;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "gbi-overview-timed-"));
  const server = await startServer({ dataDir, port: 0, today: TODAY });
  stop = server.close;
  url = server.url;
});
afterEach(async () => {
  await stop?.();
  stop = undefined;
  rmSync(dataDir, { recursive: true, force: true });
});

it(
  "answers the Overview and the alerts in under 2 s on 5 years of monthly data, once warm (AC-77)",
  async () => {
    const db = await openDatabase(dataDir);
    await loadSampleData(db, monthlySample());
    // The first load of a month catches up the snapshots (about once a month). It is not timed.
    await ensureSnapshots(db, TODAY);
    await db.destroy();
    await fetch(`${url}/api/overview`);

    const start = performance.now();
    const [overviewResponse, alertsResponse] = await Promise.all([
      fetch(`${url}/api/overview`),
      fetch(`${url}/api/alerts`),
    ]);
    const view = (await overviewResponse.json()) as OverviewView;
    await alertsResponse.json();
    const elapsed = performance.now() - start;

    expect(overviewResponse.status).toBe(200);
    expect(alertsResponse.status).toBe(200);
    expect(view.keyNumbers.netWorth).toBeGreaterThan(0);
    expect(view.keyNumbers.marketChange).not.toBeNull();
    expect(view.keyNumbers.ytdTwr).not.toBeNull();
    expect(view.keyNumbers.fiWealth).not.toBeNull();
    expect(view.goals.length).toBeGreaterThan(0);
    expect(view.plan.latest).not.toBeNull();
    expect(elapsed).toBeLessThan(READY_MS);
  },
  WARM_UP_TIMEOUT_MS,
);

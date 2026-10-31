import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "./db.ts";
import { openDatabase } from "./db.ts";
import { HttpError } from "./router.ts";
import { findOr404 } from "./rows.ts";

describe("findOr404", () => {
  let dataDir: string;
  let db: Kysely<DB>;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-rows-"));
    db = await openDatabase(dataDir);
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
  });

  afterEach(async () => {
    await db.destroy();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns the row when the id exists", async () => {
    const goal = await findOr404(db, "goal", "g1", "goal");
    expect(goal.name).toBe("Home");
  });

  it("throws a 404 HttpError named after the label when the id is missing", async () => {
    const error = await findOr404(db, "goal", "nope", "goal").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(404);
    expect((error as HttpError).message).toBe("goal not found");
  });
});

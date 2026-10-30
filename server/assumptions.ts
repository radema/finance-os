import type { Kysely } from "kysely";
import { z } from "zod";
import { shrinkToPositiveDefinite } from "../engine/correlation.ts";
import type { CorrelationsView } from "../engine/schemas.ts";
import { commissionSchema, correlationsSchema, settingsSchema } from "../engine/schemas.ts";
import type { DB } from "./db.ts";
import { loadDocument, saveDocument } from "./documents.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";

/** The assumption documents: settings, commission plan, correlations. Defaults when nothing is saved. */
export function registerAssumptionRoutes(router: Router, db: Kysely<DB>): void {
  const correlations = async (): Promise<CorrelationsView> => {
    const { matrix } = await loadDocument(db, "correlations", correlationsSchema);
    const { matrix: effective, shrunk } = shrinkToPositiveDefinite(matrix);
    return { matrix, effective, shrunk };
  };

  router.route("GET", "/api/settings", z.object({}), () =>
    loadDocument(db, "settings", settingsSchema),
  );
  router.route("PUT", "/api/settings", settingsSchema, async (settings) => {
    const { goalId } = settings.zainetto;
    if (goalId !== null) {
      const goal = await db
        .selectFrom("goal")
        .select("id")
        .where("id", "=", goalId)
        .executeTakeFirst();
      if (!goal) throw new HttpError(400, "the zainetto goal does not exist");
    }
    await saveDocument(db, "settings", settings);
    return settings;
  });

  router.route("GET", "/api/commission", z.object({}), () =>
    loadDocument(db, "commission", commissionSchema),
  );
  router.route("PUT", "/api/commission", commissionSchema, async (commission) => {
    await saveDocument(db, "commission", commission);
    return commission;
  });

  // An asymmetric matrix is rejected (400), so the stored matrix is always symmetric. One that is
  // not positive definite is stored as typed; `effective` is the shrunk copy the engine will use.
  router.route("GET", "/api/correlations", z.object({}), correlations);
  router.route("PUT", "/api/correlations", correlationsSchema, async (input) => {
    await saveDocument(db, "correlations", input);
    return correlations();
  });

  // Reset restores the default assumption documents. Products, goals and the ledger stay.
  router.route("POST", "/api/assumptions/reset", z.object({}), async () => {
    await db
      .deleteFrom("document")
      .where("kind", "in", ["settings", "commission", "correlations"])
      .execute();
    return {
      settings: await loadDocument(db, "settings", settingsSchema),
      commission: await loadDocument(db, "commission", commissionSchema),
      correlations: await correlations(),
    };
  });
}

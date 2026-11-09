import type { Kysely } from "kysely";
import type { DB } from "./db.ts";

class PreviewResult<T> extends Error {
  readonly result: T;
  constructor(result: T) {
    super("Rollback preview");
    this.result = result;
  }
}
/** Execute the real write and its validations, then roll back before returning the preview. */
export async function previewWrite<T>(
  db: Kysely<DB>,
  write: (trx: Kysely<DB>) => Promise<T>,
): Promise<T> {
  try {
    await db.transaction().execute(async (trx) => {
      throw new PreviewResult(await write(trx));
    });
  } catch (error) {
    if (error instanceof PreviewResult) return error.result as T;
    throw error;
  }
  throw new Error("The preview must roll back.");
}

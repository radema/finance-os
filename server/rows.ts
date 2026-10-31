import type { Kysely, Selectable } from "kysely";
import { z } from "zod";
import type { DB } from "./db.ts";
import { HttpError } from "./router.ts";

/** Query string of a GET or DELETE that names one row by id. */
export const idQuery = z.object({ id: z.string().min(1) });

/**
 * Loads one row by id.
 *
 * @param db Database handle.
 * @param table A table with a text `id` column.
 * @param id Row id.
 * @param label What the row is called in the error text, for example `goal`.
 * @returns The row.
 * @throws HttpError 404 `<label> not found` when no row has that id.
 */
export async function findOr404<T extends "goal" | "product" | "transaction">(
  db: Kysely<DB>,
  table: T,
  id: string,
  label: string,
): Promise<Selectable<DB[T]>> {
  // Kysely cannot resolve the `id` column over a table union, so the query is typed as "goal".
  const row = await db
    .selectFrom(table as "goal")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) throw new HttpError(404, `${label} not found`);
  return row as unknown as Selectable<DB[T]>;
}

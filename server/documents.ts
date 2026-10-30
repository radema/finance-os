import type { Kysely } from "kysely";
import type { ZodType } from "zod";
import type { DB } from "./db.ts";
import type { DocumentKind } from "./schema.ts";

/**
 * Reads a settings-like document. Nothing saved, or a saved document that lacks a field, gives the
 * schema defaults.
 */
export async function loadDocument<T>(
  db: Kysely<DB>,
  kind: DocumentKind,
  schema: ZodType<T>,
): Promise<T> {
  const row = await db
    .selectFrom("document")
    .select("value")
    .where("kind", "=", kind)
    .executeTakeFirst();
  return schema.parse(row ? JSON.parse(row.value) : {});
}

/** Stores a document that a zod schema already validated; one row per kind. */
export async function saveDocument(
  db: Kysely<DB>,
  kind: DocumentKind,
  value: unknown,
): Promise<void> {
  const json = JSON.stringify(value);
  await db
    .insertInto("document")
    .values({ kind, value: json })
    .onConflict((conflict) => conflict.column("kind").doUpdateSet({ value: json }))
    .execute();
}

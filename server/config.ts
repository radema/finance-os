import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_PORT = 8716;

/** The data folder: `GBI_DATA_DIR`, or the macOS Application Support folder of the user. */
export const resolveDataDir = (env: NodeJS.ProcessEnv): string =>
  env.GBI_DATA_DIR || join(homedir(), "Library", "Application Support", "gbi");

/** The server port: `GBI_PORT`, or the default. */
export const resolvePort = (env: NodeJS.ProcessEnv): number => Number(env.GBI_PORT || DEFAULT_PORT);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The app clock, an ISO date: `GBI_AS_OF` when set (for tests and UI checks), otherwise today. */
export function resolveToday(env: NodeJS.ProcessEnv): string {
  const asOf = env.GBI_AS_OF;
  if (asOf) {
    if (!ISO_DATE.test(asOf)) throw new Error("GBI_AS_OF must be a date, YYYY-MM-DD");
    return asOf;
  }
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

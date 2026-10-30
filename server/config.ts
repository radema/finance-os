import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_PORT = 8716;

/** The data folder: `GBI_DATA_DIR`, or the macOS Application Support folder of the user. */
export const resolveDataDir = (env: NodeJS.ProcessEnv): string =>
  env.GBI_DATA_DIR || join(homedir(), "Library", "Application Support", "gbi");

/** The server port: `GBI_PORT`, or the default. */
export const resolvePort = (env: NodeJS.ProcessEnv): number => Number(env.GBI_PORT || DEFAULT_PORT);

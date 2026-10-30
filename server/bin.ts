import { homedir } from "node:os";
import { join } from "node:path";
import { openBrowser } from "./browser.ts";
import { startServer } from "./index.ts";

const DEFAULT_PORT = 8716;

const dataDir =
  process.env.GBI_DATA_DIR || join(homedir(), "Library", "Application Support", "gbi");
const port = Number(process.env.GBI_PORT || DEFAULT_PORT);

// The built bundle sits next to the web build: dist/gbi.js and dist/web/.
const { url } = await startServer({ dataDir, port, webDir: join(import.meta.dirname, "web") });
console.log(`gbi is running at ${url}`);
console.log(`Data folder: ${dataDir}`);
console.log("Press Ctrl+C to stop.");
if (!(await openBrowser(url))) console.log("Could not open the browser. Open the URL above.");

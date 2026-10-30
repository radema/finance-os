import { join } from "node:path";
import { openBrowser } from "./browser.ts";
import { resolveDataDir, resolvePort } from "./config.ts";
import { startServer } from "./index.ts";

const dataDir = resolveDataDir(process.env);

// The built bundle sits next to the web build: dist/gbi.js and dist/web/.
const { url } = await startServer({
  dataDir,
  port: resolvePort(process.env),
  webDir: join(import.meta.dirname, "web"),
});
console.log(`gbi is running at ${url}`);
console.log(`Data folder: ${dataDir}`);
console.log("Press Ctrl+C to stop.");
if (!(await openBrowser(url))) console.log("Could not open the browser. Open the URL above.");

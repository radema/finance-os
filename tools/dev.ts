// `pnpm dev`: the API server on 127.0.0.1:8716 and the Vite dev server on 127.0.0.1:8717,
// which proxies /api to the API server. One process, so one Ctrl+C stops both.
import { createServer } from "vite";
import { resolveDataDir, resolvePort } from "../server/config.ts";
import { startServer } from "../server/index.ts";

const VITE_PORT = 8717;

const api = await startServer({
  dataDir: resolveDataDir(process.env),
  port: resolvePort(process.env),
});
const vite = await createServer({
  server: {
    host: "127.0.0.1",
    port: VITE_PORT,
    strictPort: true,
    proxy: { "/api": api.url },
  },
});
await vite.listen();
vite.printUrls();

const stop = async () => {
  await vite.close();
  await api.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

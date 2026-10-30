import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

/** Serves a file from `webDir`: `/` is `index.html`; a missing file or a path outside `webDir` is 404. */
export async function serveStatic(webDir: string, pathname: string): Promise<Response> {
  const root = resolve(webDir);
  const file = resolve(join(root, pathname === "/" ? "index.html" : pathname));
  const type = CONTENT_TYPES[extname(file)];
  if (!file.startsWith(root + sep) || !type)
    return Response.json({ error: "not found" }, { status: 404 });
  try {
    return new Response(await readFile(file), { headers: { "content-type": type } });
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }
}

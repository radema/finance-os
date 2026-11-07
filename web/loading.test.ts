import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webDir = dirname(fileURLToPath(import.meta.url));
const LOADING_COMPONENT = "Loading.tsx";

const sourcesIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesIn(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });

describe("the loading text", () => {
  it("is written once, in the shared Loading component", () => {
    const literal = /Loading(\.(?!tsx)|…)/;
    const files = sourcesIn(webDir)
      .filter((path) => literal.test(readFileSync(path, "utf8")))
      .map((path) => relative(webDir, path));
    expect(files).toEqual([LOADING_COMPONENT]);
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";

/** One broken layer rule: where it happened, which rule, and the import or text that broke it. */
export type Violation = {
  file: string;
  rule:
    | "engine-no-node"
    | "engine-no-server"
    | "engine-no-web"
    | "web-no-server"
    | "web-no-colour-literal"
    | "sql-only-in-server";
  detail: string;
};

const SKIPPED_DIRS = new Set(["node_modules", "dist", "coverage"]);
// The checker and its tests hold import and SQL strings as data, so they are not scanned.
const SELF_DIR = "tools/architecture/";
const SOURCE_FILE = /\.(?:ts|tsx|mts|cts|css)$/;

// Static imports and re-exports, side-effect imports, dynamic import() and require().
const IMPORT_SPECIFIER =
  /\b(?:import|export)\b[^'"`;]*?\bfrom\s*(['"])(.+?)\1|\bimport\s*(['"])(.+?)\3|\b(?:import|require)\s*\(\s*(['"])(.+?)\5/g;

// Keywords match in upper case only, so prose such as "Delete from history" stays quiet.
const SQL_TEXT =
  /\bSELECT\s[^;]{1,200}?\sFROM\s+\w+|\b(?:INSERT\s+INTO|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\s+\w+|\bUPDATE\s+\w+\s+SET\s+\w+/g;

// Hex colours and colour functions. Colours live in web/tokens.css; everything else reads a token.
const COLOUR_LITERAL =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g;
const TOKEN_FILE = "web/tokens.css";

const isNodeModule = (specifier: string): boolean =>
  specifier.startsWith("node:") || builtinModules.includes(specifier.split("/")[0] ?? specifier);

const isSqlModule = (specifier: string): boolean =>
  specifier === "kysely" || specifier.startsWith("kysely/") || specifier === "node:sqlite";

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIPPED_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(path));
    else if (SOURCE_FILE.test(entry.name)) files.push(path);
  }
  return files;
}

/** The top-level folder a relative import lands in, or undefined for a bare specifier. */
function targetFolder(rootDir: string, file: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  return relative(rootDir, resolve(dirname(file), specifier)).split(sep)[0];
}

/**
 * Checks the structural rules 1-3 of CLAUDE.md and the no-colour-literal rule of DESIGN.md on every source file under `rootDir`.
 *
 * @param rootDir Folder that holds `engine/`, `server/` and `web/`.
 * @returns The violations found; an empty array means the tree is clean.
 */
export function checkArchitecture(rootDir: string): Violation[] {
  const violations: Violation[] = [];

  for (const file of listSourceFiles(rootDir)) {
    const rel = relative(rootDir, file).split(sep).join("/");
    if (rel.startsWith(SELF_DIR)) continue;
    const folder = rel.split("/")[0];
    const text = readFileSync(file, "utf8");
    const add = (rule: Violation["rule"], detail: string) =>
      violations.push({ file: rel, rule, detail });

    for (const match of text.matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[2] ?? match[4] ?? match[6] ?? "";
      const target = targetFolder(rootDir, file, specifier);

      if (folder === "engine") {
        if (isNodeModule(specifier)) add("engine-no-node", specifier);
        if (target === "server") add("engine-no-server", specifier);
        if (target === "web") add("engine-no-web", specifier);
      }
      if (folder === "web" && target === "server") add("web-no-server", specifier);
      if (folder !== "server" && isSqlModule(specifier)) add("sql-only-in-server", specifier);
    }

    if (folder === "web" && rel !== TOKEN_FILE) {
      for (const match of text.matchAll(COLOUR_LITERAL)) add("web-no-colour-literal", match[0]);
    }

    if (folder !== "server") {
      for (const match of text.matchAll(SQL_TEXT)) add("sql-only-in-server", match[0]);
    }
  }

  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule));
}

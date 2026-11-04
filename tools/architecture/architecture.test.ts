import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkArchitecture } from "./check.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("checkArchitecture on the real tree", () => {
  it("finds no violation", () => {
    expect(checkArchitecture(repoRoot)).toEqual([]);
  });
});

describe("checkArchitecture on planted violations", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "gbi-arch-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const plant = (file: string, content: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  };

  it("is clean when every import respects the layers", () => {
    plant("engine/a.ts", 'import { b } from "./b.ts";\nexport const a = b;\n');
    plant("engine/b.ts", "export const b = 1;\n");
    plant("web/c.ts", 'import { a } from "../engine/a.ts";\nexport const c = a;\n');
    plant(
      "server/d.ts",
      'import { a } from "../engine/a.ts";\nimport "node:fs";\nexport const d = a;\n',
    );
    expect(checkArchitecture(root)).toEqual([]);
  });

  it("flags engine importing a node:* module", () => {
    plant(
      "engine/a.ts",
      'import { readFileSync } from "node:fs";\nexport const a = readFileSync;\n',
    );
    expect(checkArchitecture(root)).toEqual([
      { file: "engine/a.ts", rule: "engine-no-node", detail: "node:fs" },
    ]);
  });

  it("flags engine importing a builtin without the node: prefix", () => {
    plant("engine/a.ts", 'import { join } from "path";\nexport const a = join;\n');
    expect(checkArchitecture(root)).toEqual([
      { file: "engine/a.ts", rule: "engine-no-node", detail: "path" },
    ]);
  });

  it("flags engine importing server/", () => {
    plant("engine/a.ts", 'import { d } from "../server/d.ts";\nexport const a = d;\n');
    plant("server/d.ts", "export const d = 1;\n");
    expect(checkArchitecture(root)).toEqual([
      { file: "engine/a.ts", rule: "engine-no-server", detail: "../server/d.ts" },
    ]);
  });

  it("flags engine importing web/", () => {
    plant("engine/a.ts", 'import { c } from "../web/c.ts";\nexport const a = c;\n');
    plant("web/c.ts", "export const c = 1;\n");
    expect(checkArchitecture(root)).toEqual([
      { file: "engine/a.ts", rule: "engine-no-web", detail: "../web/c.ts" },
    ]);
  });

  it("flags web importing server/, also through a dynamic import", () => {
    plant("web/c.ts", 'export const load = () => import("../server/d.ts");\n');
    plant("server/d.ts", "export const d = 1;\n");
    expect(checkArchitecture(root)).toEqual([
      { file: "web/c.ts", rule: "web-no-server", detail: "../server/d.ts" },
    ]);
  });

  it("flags a kysely import outside server/", () => {
    plant("web/c.ts", 'import { Kysely } from "kysely";\nexport const c = Kysely;\n');
    expect(checkArchitecture(root)).toEqual([
      { file: "web/c.ts", rule: "sql-only-in-server", detail: "kysely" },
    ]);
  });

  it("flags a node:sqlite import outside server/", () => {
    plant(
      "engine/a.ts",
      'import { DatabaseSync } from "node:sqlite";\nexport const a = DatabaseSync;\n',
    );
    expect(checkArchitecture(root)).toContainEqual({
      file: "engine/a.ts",
      rule: "sql-only-in-server",
      detail: "node:sqlite",
    });
  });

  it("flags SQL statement text outside server/", () => {
    // Built from parts so that this file does not contain SQL text itself.
    const sql = ["SELECT", "id", "FROM", "goals"].join(" ");
    plant("shared/q.ts", `export const q = "${sql}";\n`);
    expect(checkArchitecture(root)).toEqual([
      { file: "shared/q.ts", rule: "sql-only-in-server", detail: sql },
    ]);
  });

  it("ignores ordinary prose that reads like SQL outside server/", () => {
    plant(
      "web/copy.ts",
      'export const t = ["Select an account from the list", "Delete from history", "Update total set by you"];\n',
    );
    expect(checkArchitecture(root)).toEqual([]);
  });

  it("still flags upper-case DELETE FROM and UPDATE ... SET outside server/", () => {
    const del = ["DELETE", "FROM", "goals"].join(" ");
    const upd = ["UPDATE", "goals", "SET", "x"].join(" ");
    plant("web/q.ts", `export const q = ["${del}", "${upd}"];\n`);
    expect(checkArchitecture(root).map((v) => v.detail)).toEqual([del, upd]);
  });

  it("allows kysely, node:* and SQL text inside server/", () => {
    const sql = ["INSERT", "INTO", "goals"].join(" ");
    plant(
      "server/d.ts",
      `import { Kysely } from "kysely";\nimport "node:sqlite";\nexport const d = [Kysely, "${sql}"];\n`,
    );
    expect(checkArchitecture(root)).toEqual([]);
  });

  it("flags a colour literal in web/ CSS and TSX, but not in tokens.css", () => {
    plant("web/tokens.css", ":root { --ink: #171b1f; --shadow: 0 1px rgba(0, 0, 0, 0.5); }\n");
    plant("web/a.css", ".a { color: #fff; border-color: hsl(10 20% 30%); }\n");
    plant("web/b.tsx", 'export const b = { color: "#b75a26", fill: "var(--hl)" };\n');
    plant("web/c.css", ".c { background: color-mix(in srgb, var(--slot) 40%, transparent); }\n");
    expect(checkArchitecture(root)).toEqual([
      { file: "web/a.css", rule: "web-no-colour-literal", detail: "#fff" },
      { file: "web/a.css", rule: "web-no-colour-literal", detail: "hsl(" },
      { file: "web/b.tsx", rule: "web-no-colour-literal", detail: "#b75a26" },
    ]);
  });

  it("ignores node_modules and dot folders", () => {
    plant("node_modules/x/index.ts", 'import "node:fs";\nimport { Kysely } from "kysely";\n');
    plant(".scratch/p/a.ts", 'import { Kysely } from "kysely";\n');
    expect(checkArchitecture(root)).toEqual([]);
  });
});

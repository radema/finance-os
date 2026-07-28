/**
 * OFFLINE AUDIT — the Local First promise (ADR-0008), checked rather than stated.
 *
 *     node docs/design/audit_offline.mjs
 *
 * There is no browser in this environment, so "the charts initialise and the
 * console is clean" is verified the only honest way available: by running the
 * SHIPPED pipeline. This script loads the real static/js/charts.js under a
 * minimal DOM shim, feeds it the real token values parsed out of the real
 * tokens.css, hands it every option the real preview emits, and renders each one
 * through ECharts' server-side renderer. A throw anywhere is a failure.
 *
 * It checks:
 *   1. zero off-origin references in every generated page
 *   2. every stylesheet, script and font referenced actually exists on disk
 *   3. no server-assembled chart option contains a hex colour
 *   4. every "token:--name" reference resolves to a real value, in BOTH schemes
 *   5. every option is accepted by ECharts and renders a non-empty SVG
 *   6. the mark roles are consumed (no "mark" key survives into the option)
 *
 * Exit 1 on any failure, so it can gate a build.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const STATIC = path.join(ROOT, "src", "financeos", "web", "static");

let failures = 0;
const fail = (msg) => { failures++; console.log(`  [FAIL] ${msg}`); };
const pass = (msg) => console.log(`  [PASS] ${msg}`);

// ── 1 + 2 — off-origin references, and every local reference resolves ────────
const PAGES = [
  path.join(ROOT, "docs", "design", "preview.html"),
  ...fs.existsSync(path.join(ROOT, "docs", "design", "worlds"))
    ? fs.readdirSync(path.join(ROOT, "docs", "design", "worlds"))
        .filter((f) => f.endsWith(".html"))
        .map((f) => path.join(ROOT, "docs", "design", "worlds", f))
    : [],
];

function auditPage(file) {
  const html = fs.readFileSync(file, "utf8");
  const rel = path.relative(ROOT, file);

  const offOrigin = [
    ...html.matchAll(/(?:src|href)\s*=\s*["'](https?:\/\/|\/\/)[^"']*/gi),
    ...html.matchAll(/url\(\s*["']?(https?:\/\/|\/\/)[^)]*/gi),
    ...html.matchAll(/@import\s+(?:url\()?["']?(https?:\/\/|\/\/)[^;]*/gi),
  ].map((m) => m[0]);
  if (offOrigin.length) fail(`${rel}: ${offOrigin.length} off-origin ref(s): ${offOrigin[0]}`);
  else pass(`${rel}: zero off-origin references`);

  const refs = [
    ...[...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]),
    ...[...html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map((m) => m[1]),
  ].filter((u) => u && !u.startsWith("#") && !u.startsWith("data:"));

  const missing = refs.filter((u) => !fs.existsSync(path.resolve(path.dirname(file), u)));
  if (missing.length) fail(`${rel}: ${missing.length} dead local ref(s): ${missing.join(", ")}`);
  else pass(`${rel}: all ${refs.length} local refs resolve on disk`);
}

// Faces declared in the stylesheet must exist too — a deleted woff2 that a
// @font-face still names is a silent fallback to a system font, and the three
// voices stop being three voices.
function auditFaces() {
  const css = fs.readFileSync(path.join(STATIC, "css", "base.css"), "utf8");
  const urls = [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]);
  const missing = urls.filter(
    (u) => !fs.existsSync(path.resolve(path.join(STATIC, "css"), u))
  );
  if (missing.length) fail(`base.css names ${missing.length} missing face(s): ${missing.join(", ")}`);
  else pass(`base.css: all ${urls.length} @font-face files present on disk`);

  // Unused faces are reported, NOT failed: the faces have not settled yet, so
  // the spares are deliberately still vendored. This becomes a hard failure the
  // day the three voices are final — see docs/design/WORLD-B-RESUME.md.
  const onDisk = fs.readdirSync(path.join(STATIC, "fonts")).filter((f) => f.endsWith(".woff2"));
  const used = new Set(urls.map((u) => path.basename(u)));
  const orphans = onDisk.filter((f) => !used.has(f));
  if (orphans.length) {
    console.log(`  [NOTE] ${orphans.length} vendored woff2 not referenced by any @font-face`);
    console.log(`         (faces not settled; deletable once they are): ${orphans.join(", ")}`);
  } else {
    pass(`fonts/: no unused woff2 (${onDisk.length} shipped, all referenced)`);
  }
}

// ── the token layer, parsed from the shipped stylesheet ──────────────────────
function tokensFor(scheme) {
  const css = fs.readFileSync(path.join(STATIC, "css", "tokens.css"), "utf8");
  const map = new Map();
  const collect = (block) => {
    for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      map.set(m[1], m[2].trim());
    }
  };
  // :root carries the dark scheme (this world is dark-first), then the explicit
  // [data-theme] stamp overrides it — the same order the browser applies.
  const root = css.match(/:root\s*\{([\s\S]*?)\n\}/);
  if (root) collect(root[1]);
  const stamped = css.match(new RegExp(`\\[data-theme="${scheme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!stamped) throw new Error(`tokens.css has no [data-theme="${scheme}"] block`);
  collect(stamped[1]);

  // resolve one level of var() indirection, which is all the token layer uses
  for (const [k, v] of map) {
    const ref = v.match(/^var\((--[a-z0-9-]+)\)$/);
    if (ref && map.has(ref[1])) map.set(k, map.get(ref[1]));
  }
  return map;
}

// ── the DOM shim: just enough for charts.js to load and for prepare() to run ─
function loadCharts(tokens) {
  const el = { id: "audit", getAttribute: () => null, setAttribute: () => {} };
  const sandbox = {
    getComputedStyle: () => ({ getPropertyValue: (n) => tokens.get(n) ?? "" }),
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    document: {
      readyState: "complete",
      querySelectorAll: () => [],
      getElementById: () => null,
      addEventListener: () => {},
      body: null,
    },
    echarts: require(path.join(STATIC, "vendor", "echarts", "echarts.min.js")),
    Intl,
    Math,
    Object,
    Array,
    JSON,
    console,
  };
  sandbox.window = sandbox;
  const src = fs.readFileSync(path.join(STATIC, "js", "charts.js"), "utf8");
  // eslint-disable-next-line no-new-func
  new Function("window", "document", "getComputedStyle", "matchMedia", "echarts", src)(
    sandbox, sandbox.document, sandbox.getComputedStyle, sandbox.matchMedia, sandbox.echarts
  );
  if (!sandbox.FinanceOSCharts) throw new Error("charts.js did not expose FinanceOSCharts");
  return { api: sandbox.FinanceOSCharts, echarts: sandbox.echarts, el };
}

// ── 3-6 — every shipped option, in both schemes ──────────────────────────────
function auditOptions() {
  const html = fs.readFileSync(PAGES[0], "utf8");
  const found = [...html.matchAll(
    /<script type="application\/json" id="([^"]+)">([\s\S]*?)<\/script>/g
  )];
  if (!found.length) return fail("preview.html carries no chart options at all");

  let ok = 0;
  for (const scheme of ["light", "dark"]) {
    const tokens = tokensFor(scheme);
    const { api, echarts, el } = loadCharts(tokens);
    for (const [, id, raw] of found) {
      // the preview names each canvas <chart>-<scheme>, so audit each option in
      // the scheme it actually renders in
      if (!id.includes(`-${scheme}-`) && !id.endsWith(`-${scheme}-option`)) continue;

      const hex = raw.match(/#[0-9a-fA-F]{3,8}\b/g);
      if (hex) fail(`${id}: server option carries a hex colour: ${hex.join(", ")}`);

      let option;
      try {
        option = api.prepare(JSON.parse(raw), el);
      } catch (e) {
        fail(`${id} (${scheme}): prepare() threw: ${e.message}`);
        continue;
      }

      const serialised = JSON.stringify(option);
      if (serialised.includes("token:")) {
        const left = serialised.match(/"token:--[a-z0-9-]+"/g) ?? [];
        fail(`${id} (${scheme}): unresolved token reference(s): ${[...new Set(left)].join(", ")}`);
      }
      if (/"mark":/.test(serialised)) fail(`${id} (${scheme}): a mark role was not consumed`);

      try {
        const chart = echarts.init(null, null, {
          renderer: "svg", ssr: true, width: 640, height: 260,
        });
        chart.setOption(option);
        const svg = chart.renderToSVGString();
        chart.dispose();
        if (!svg || svg.length < 400) fail(`${id} (${scheme}): rendered an empty SVG`);
        else ok++;
      } catch (e) {
        fail(`${id} (${scheme}): ECharts threw on setOption: ${e.message}`);
      }
    }
  }
  if (ok) pass(`${ok} chart option(s) resolved, accepted by ECharts and rendered`);
}

console.log("\nFINANCE OS — offline audit\n");
PAGES.forEach(auditPage);
auditFaces();
auditOptions();
console.log(
  failures ? `\n  -> ${failures} FAILURE(S)\n` : "\n  -> ALL CHECKS PASS\n"
);
process.exit(failures ? 1 : 0);

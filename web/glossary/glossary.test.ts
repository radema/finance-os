import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { isBuilt, SETUP_TABS } from "../nav.ts";
import { GlossaryScreen } from "./GlossaryScreen.tsx";
import { TermPopover } from "./TermPopover.tsx";
import { GLOSSARY } from "./terms.ts";

/** The terms of the spec's glossary list (S6), one key each. */
const LISTED = [
  "prob",
  "required",
  "simulated",
  "atrisk",
  "badcase",
  "typical",
  "goodcase",
  "nominal",
  "real",
  "twr",
  "xirr",
  "drawdown",
  "pmc",
  "zainetto",
  "fire",
  "barista",
  "opening",
  "need",
  "isin",
  "coupon",
  "stale",
  "minticket",
  "bollo",
  "exitTax",
  "whitelist",
] as const;

const METHOD_TOPICS = [
  "Time grid and the 31 December due date",
  "Taxes by regime",
  "Monte Carlo",
  "Required contribution",
  "Financial independence levels",
  "Performance formulas",
  "Optimizer rules",
  "Kept simplifications",
  "Pension capital and annuity",
];

describe("glossary data (AC-85)", () => {
  it("has exactly the listed terms, each with Italian, English and an explanation", () => {
    expect(Object.keys(GLOSSARY).sort()).toEqual([...LISTED].sort());
    for (const key of LISTED) {
      const term = GLOSSARY[key];
      expect(term.it.trim(), key).not.toBe("");
      expect(term.en.trim(), key).not.toBe("");
      expect(term.explanation.trim(), key).not.toBe("");
    }
  });

  it("never shows a raw P10, P50 or P90", () => {
    for (const term of Object.values(GLOSSARY)) {
      expect(`${term.it} ${term.en} ${term.explanation}`).not.toMatch(/\bP(10|50|90)\b/);
    }
  });
});

describe("Glossary & method screen (AC-85)", () => {
  const html = renderToString(createElement(GlossaryScreen));

  it("is a built route", () => {
    expect(isBuilt("setup/glossary")).toBe(true);
  });

  it("lists every term with Italian term, English term and explanation", () => {
    for (const term of Object.values(GLOSSARY)) {
      expect(html).toContain(term.it);
      expect(html).toContain(term.en);
      expect(html).toContain(term.explanation);
    }
  });

  it("makes the glossary card an h2 and each method note an h3 under the Method notes h2", () => {
    expect(html).toMatch(/<h2[^>]*>.*?Glossary<\/span><\/h2>/);
    expect(html.match(/<h3 /g)).toHaveLength(METHOD_TOPICS.length);
  });

  it("shows the Setup tab bar with Glossary as the current tab, under the title Glossary", () => {
    expect(html).toContain('<h1 class="title">Glossary</h1>');
    expect(html).toMatch(/<nav class="tabs" aria-label="Setup">/);
    for (const tab of SETUP_TABS) expect(html).toContain(`href="#/${tab.key}"`);
    expect(html).toMatch(/aria-current="page"[^>]*>Glossary<\/a>/);
    expect(html.indexOf('<h1 class="title">')).toBeLessThan(html.indexOf('class="tabs"'));
  });

  it("sorts the terms A to Z by English term, and gives each row an anchor", () => {
    const keys = [...html.matchAll(/<tr id="(term-[^"]+)"/g)].map((m) => m[1]);
    expect(keys).toHaveLength(Object.keys(GLOSSARY).length);
    const english = keys.map((id) => GLOSSARY[id.replace("term-", "") as keyof typeof GLOSSARY].en);
    const lower = english.map((en) => en.toLowerCase());
    expect(lower).toEqual([...lower].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(english.slice(0, 4)).toEqual([
      "at-risk band",
      "average cost",
      "bad case",
      "Barista FIRE",
    ]);
  });

  it("heads the method notes with a section heading, and lists them in a contents line first", () => {
    expect(html).toContain('<h2 class="method-title">Method notes</h2>');
    expect(html).not.toContain('class="block-title"');
    expect(html.indexOf('aria-label="Contents"')).toBeLessThan(html.indexOf("<table"));
  });

  it("links the contents line to all nine method notes, and each link lands on its card", () => {
    const nav = html.match(/<nav class="method-contents"[^>]*>(.*?)<\/nav>/)?.[1] ?? "";
    const links = [...nav.matchAll(/<a href="#\/setup\/glossary\?at=([^"]+)">([^<]+)<\/a>/g)];
    expect(links.map((m) => m[2])).toEqual(METHOD_TOPICS);
    for (const [, id] of links) expect(html).toContain(`id="${id}"`);
    expect(new Set(links.map((m) => m[1])).size).toBe(METHOD_TOPICS.length);
  });

  it("names the optimizer rules without a criterion id", () => {
    expect(html).toContain("Protect the bad case");
    expect(html).not.toMatch(/\bO\d\b/);
  });

  it("covers each method topic, the four simplifications and the capital note", () => {
    for (const topic of METHOD_TOPICS) expect(html).toContain(topic);
    expect(html).toContain("exit tax base is all contributions");
    expect(html).toContain("extra deduction every year");
    expect(html).toContain("taxed 20% flat");
    expect(html).toContain("0.2% a year");
    expect(html).toContain("at most 50% of the pension pot");
    expect(html).toContain("31 October 2026");
  });
});

describe("TermPopover", () => {
  const html = renderToString(createElement(TermPopover, { term: "pmc" }));

  it("renders a button with the English term, and no title attribute", () => {
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>average cost<\/button>/);
    expect(html).not.toContain("title=");
  });

  it("puts the Italian term before the explanation in the popover", () => {
    expect(html).toContain('popover="auto"');
    const it = html.indexOf(GLOSSARY.pmc.it);
    const explanation = html.indexOf(GLOSSARY.pmc.explanation);
    expect(it).toBeGreaterThan(-1);
    expect(explanation).toBeGreaterThan(it);
  });

  it("takes its own text as children, with the same popover", () => {
    const short = renderToString(createElement(TermPopover, { term: "pmc" }, "PMC"));
    expect(short).toMatch(/>PMC<\/button>/);
    expect(short).toContain(GLOSSARY.pmc.explanation);
  });
});

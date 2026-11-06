import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { isBuilt } from "../nav.ts";
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
    expect(html).toContain('<h2 class="block-title">Method notes</h2>');
    expect(html.match(/<h3 /g)).toHaveLength(METHOD_TOPICS.length);
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

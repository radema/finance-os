import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { settingsSchema } from "../../engine/schemas.ts";
import { SettingsForm } from "./AssumptionsTab.tsx";

const html = renderToStaticMarkup(
  createElement(SettingsForm, { settings: settingsSchema.parse({}), goals: [] }),
);
const text = html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'");

describe("Assumptions text (AC-89)", () => {
  it("never shows the words spec or mock, or a rule code", () => {
    expect(text).not.toMatch(/\b(spec|mock)\b/i);
    expect(text).not.toMatch(/\bR(1|3|7)\b/);
  });

  it("names each rule threshold by its effect", () => {
    for (const label of [
      "Behind plan: alert after (months)",
      "Maturity ahead: warn within (months)",
      "Costly trades: alert above (times your fee rate)",
      "(points below the required probability)",
      "Price counts as old after (days)",
    ]) {
      expect(text, label).toContain(label);
    }
    expect(text).toContain("At-risk band");
  });

  it("gives the seed, the inflation and each of the five thresholds a one-line hint", () => {
    expect(html.match(/class="field-hint"/g) ?? []).toHaveLength(7);
    expect(text).toContain("Used to turn today's euros into future euros.");
    expect(text).toContain("The same seed gives the same simulated results.");
  });
});

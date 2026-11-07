import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Alert, Severity } from "../../engine/rules.ts";
import { AttentionCell } from "./cells.tsx";

const alert = (ruleId: Alert["ruleId"], name: string, severity: Severity): Alert => ({
  ruleId,
  name,
  severity,
  condition: "Some condition.",
  scope: { kind: "none", id: "" },
  key: "k",
});

const html = renderToStaticMarkup(
  createElement(AttentionCell, {
    alerts: [
      alert("R2", "Deduction room", "Info"),
      alert("R3", "Maturity ahead", "Medium"),
      alert("R6", "Need off track", "High"),
    ],
    error: undefined,
    onDismiss: () => {},
  }),
);
const text = html.replace(/<[^>]*>/g, " ");

describe("Needs attention rows (AC-72, AC-89)", () => {
  it("shows no rule id in the visible text", () => {
    expect(text).not.toMatch(/R\d+/);
  });

  it("shows the alert name as the link title", () => {
    expect(html).toMatch(/<a [^>]*>Deduction room<\/a>/);
  });

  it("shows each severity as a chip with an icon and its word", () => {
    for (const severity of ["Info", "Medium", "High"]) {
      expect(html).toMatch(
        new RegExp(
          `<span class="severity severity-${severity}"><svg[^>]*>.*?</svg>${severity}</span>`,
        ),
      );
    }
  });

  it("keeps the dismiss button", () => {
    expect(html.match(/>Dismiss</g)).toHaveLength(3);
  });
});

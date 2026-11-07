import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DateInput } from "./DateInput.tsx";

const render = (value: string) =>
  renderToStaticMarkup(
    createElement(DateInput, { value, onChange: () => {}, "aria-label": "As of" }),
  );

describe("date field (AC-89)", () => {
  it("keeps the native date input", () => {
    expect(render("2026-03-01")).toMatch(/<input[^>]*type="date"[^>]*value="2026-03-01"/);
  });
  it("shows the picked date in ISO next to the input", () => {
    expect(render("2026-03-01")).toMatch(/\/><span[^>]*>2026-03-01<\/span>/);
  });
  it("shows the format when no date is picked", () => {
    expect(render("")).toMatch(/\/><span[^>]*>YYYY-MM-DD<\/span>/);
  });
});

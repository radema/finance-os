import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FilePicker } from "./FilePicker.tsx";

const render = (fileName: string | undefined, disabled = false) =>
  renderToStaticMarkup(
    createElement(FilePicker, {
      label: "Choose a file",
      accept: ".csv",
      fileName,
      disabled,
      onChange: () => {},
    }),
  );
const css = readFileSync(new URL("../setup.css", import.meta.url), "utf8");

describe("file picker (AC-89)", () => {
  it("is an outlined button with the label text, wrapping a real file input", () => {
    const html = render(undefined);
    expect(html).toMatch(/<label class="btn[^"]*">Choose a file<input[^>]*type="file"/);
    expect(html).toContain('accept=".csv"');
  });
  it("shows No file chosen before a choice, and the file name after", () => {
    expect(render(undefined)).toContain("No file chosen");
    const html = render("prices.csv");
    expect(html).toContain("prices.csv");
    expect(html).not.toContain("No file chosen");
  });
  it("describes the input by the file name, for screen readers", () => {
    const html = render("prices.csv");
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
  });
  it("keeps the input in the tab order: no hidden attribute, no negative tabindex", () => {
    const html = render(undefined);
    expect(html).not.toMatch(/\shidden/);
    expect(html).not.toContain("tabindex");
    const rule = /\.file-picker input\[type="file"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).not.toBe("");
    expect(rule).not.toContain("display: none");
    expect(rule).not.toContain("visibility");
  });
  it("shows the focus ring on the button when the input has focus", () => {
    expect(css).toMatch(/\.file-picker \.btn:has\(input:focus-visible\)/);
  });
  it("passes disabled to the input", () => {
    expect(render(undefined, true)).toMatch(/<input[^>]*disabled/);
  });
});

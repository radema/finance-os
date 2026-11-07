import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FetchOutcome } from "./OnlinePrices.tsx";

const render = (
  summary: string | undefined,
  errors: { productId: string; productName: string; message: string }[],
) => renderToStaticMarkup(createElement(FetchOutcome, { summary, errors }));
const failure = { productId: "p1", productName: "VWCE", message: "The product has no ticker." };

describe("fetch result message (AC-89)", () => {
  it("shows the summary and the problems in one message", () => {
    const html = render("Stored 0, held for review 0.", [failure]);
    expect(html.match(/role="alert"/g)).toHaveLength(1);
    expect(html).toContain("Stored 0, held for review 0.");
    expect(html).toContain("VWCE: The product has no ticker.");
    expect(html).not.toContain("problems 1");
  });

  it("shows the summary alone when nothing failed", () => {
    const html = render("Stored 2, held for review 0.", []);
    expect(html).not.toContain('role="alert"');
    expect(html).toContain("Stored 2, held for review 0.");
  });

  it("shows only the problems before any fetch of this visit", () => {
    const html = render(undefined, [failure]);
    expect(html.match(/role="alert"/g)).toHaveLength(1);
    expect(html).toContain("Fetch failed for");
  });

  it("shows nothing when there is nothing to say", () => {
    expect(render(undefined, [])).toBe("");
  });
});

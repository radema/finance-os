import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PricesScreen } from "./PricesScreen.tsx";

const countOf = (html: string, text: string) => html.split(text).length - 1;

describe("Prices screen", () => {
  it("shows each card once", () => {
    const html = renderToStaticMarkup(createElement(PricesScreen));
    for (const title of [
      "Price source per product",
      "Online prices",
      "Month-end prices",
      "Import prices from CSV",
    ]) {
      expect(countOf(html, title)).toBe(1);
    }
  });
});

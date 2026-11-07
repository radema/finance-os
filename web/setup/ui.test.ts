import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TermPopover } from "../glossary/TermPopover.tsx";
import { Card, Field, NumberField, TextField } from "./ui.tsx";

type Props<T extends (props: never) => unknown> = Parameters<T>[0];
const card = (props: Omit<Props<typeof Card>, "children">) =>
  createElement(Card, props as Props<typeof Card>, "body");
const render = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(element);

describe("Card heading (AC-89)", () => {
  it("renders the title as an h2 that holds the toggle button", () => {
    const html = render(card({ title: "Goals" }));
    expect(html).toMatch(
      /<h2 class="card-head card-head-row"[^>]*><button[^>]*class="card-toggle"/,
    );
    expect(html).not.toContain("<header");
  });

  it("is an h3 when the level is 3", () => {
    const html = render(card({ title: "Goals", level: 3 }));
    expect(html).toMatch(/<h3 class="card-head card-head-row"/);
    expect(html).not.toContain("<h2");
  });

  it("names the heading by its title text, not by title plus button", () => {
    const html = render(card({ title: "Goals" }));
    const labelled = /<h2[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelled).toBeDefined();
    expect(html).toContain(`<span id="${labelled}">Goals</span>`);
  });
});

describe("Field with a term label (AC-89)", () => {
  const html = render(
    createElement(TextField, {
      label: createElement(TermPopover, { term: "isin" }, "ISIN"),
      value: "",
      onChange: () => {},
      required: true,
    }),
  );

  it("wraps the label row in a label that points at the input", () => {
    const labelFor = /<label[^>]*class="field-label"[^>]*for="([^"]+)"/.exec(html)?.[1];
    expect(labelFor).toBeDefined();
    expect(html).toMatch(new RegExp(`<input id="${labelFor}" type="text"`));
  });

  it("keeps the term button and the required mark inside that label", () => {
    const label = /<label.*?<\/label>/s.exec(html)?.[0] ?? "";
    expect(label).toContain('class="term"');
    expect(label).toContain("*");
    expect(label).not.toContain("<input");
  });

  it("links a div field with a string label too", () => {
    const text = render(
      createElement(
        Field,
        { label: "Tax regime", wrap: "div" } as Props<typeof Field>,
        ((_labelId: string, id: string) => createElement("select", { id })) as never,
      ),
    );
    expect(text).toMatch(/<label[^>]*for="([^"]+)"/);
  });
});

describe("NumberField unit (AC-89)", () => {
  const number = (unit?: string) =>
    render(
      createElement(NumberField, { label: "RAL a year", value: "", onChange: () => {}, unit }),
    );

  it("shows the unit inside the field and names it with the control", () => {
    const html = number("€");
    const unitId = /<span id="([^"]+)" class="field-unit">€<\/span>/.exec(html)?.[1];
    expect(unitId).toBeDefined();
    expect(html).toMatch(new RegExp(`<input[^>]*aria-labelledby="[^"]+ ${unitId}"`));
    expect(html).toMatch(/<span class="input-unit"><input.*field-unit.*<\/span><\/span>/);
  });

  it("is unchanged without a unit", () => {
    const html = number();
    expect(html).not.toContain("field-unit");
    expect(html).not.toContain("input-unit");
  });
});

describe("NumberField text (AC-89)", () => {
  const field = (value: string) =>
    render(createElement(NumberField, { label: "Return", value, onChange: () => {} }));

  it("is a text box for decimals, not a number input", () => {
    const html = field("");
    expect(html).toContain('type="text"');
    expect(html).toContain('inputMode="decimal"');
    expect(html).not.toContain('type="number"');
  });

  it("shows a stored dot as a comma", () => {
    expect(field("6.5")).toContain('value="6,5"');
    expect(field("42000")).toContain('value="42000"');
  });
});

describe("NumberField placeholder (AC-89)", () => {
  it("shows an example while empty and has none by default", () => {
    const html = (placeholder?: string) =>
      render(
        createElement(NumberField, { label: "Income", value: "", onChange: () => {}, placeholder }),
      );
    expect(html("e.g. 36000")).toContain('placeholder="e.g. 36000"');
    expect(html()).not.toContain("placeholder");
  });
});

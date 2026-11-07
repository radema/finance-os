import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RowActions, type RowEditor, type RowEditorOptions, useRowEditor } from "./rowEditor.tsx";

const planButton = createElement("button", { type: "button" }, "Plan");

function renderCell(props: { editable?: boolean; before?: ReactNode } = {}) {
  const editor = { edit: vi.fn(), copy: vi.fn() };
  const cell = createElement(RowActions<string>, {
    row: "r1",
    editor,
    noun: "goal",
    onDelete: () => {},
    ...props,
  });
  return {
    editor,
    cell,
    html: renderToStaticMarkup(
      createElement("table", null, createElement("tbody", null, createElement("tr", null, cell))),
    ),
  };
}

/** Calls the `onClick` of every plain button under `node`, without a DOM. */
function clickButtons(node: ReactNode): void {
  if (!isValidElement<{ onClick?: () => void; children?: ReactNode }>(node)) return;
  if (node.type === "button") node.props.onClick?.();
  for (const child of [node.props.children].flat()) clickButtons(child);
}

describe("RowActions", () => {
  it("shows Edit, Duplicate and Delete in a row-actions cell", () => {
    const { html } = renderCell();
    expect(html).toContain('<td class="row-actions">');
    expect(html).toMatch(/>Edit<\/button><button[^>]*>Duplicate<\/button>/);
    expect(html).toContain(">Delete<");
  });

  it("puts extra buttons first", () => {
    expect(renderCell({ before: planButton }).html).toMatch(/>Plan<\/button><button[^>]*>Edit</);
  });

  it("drops Edit and Duplicate when the row is not editable", () => {
    const { html } = renderCell({ editable: false });
    expect(html).not.toContain("Edit");
    expect(html).not.toContain("Duplicate");
    expect(html).toContain(">Delete<");
  });

  it("hands its row to the editor from Edit and from Duplicate", () => {
    const { editor } = renderCell();
    clickButtons(RowActions({ row: "r1", editor, noun: "goal", onDelete: () => {} }));
    expect(editor.edit).toHaveBeenCalledExactlyOnceWith("r1");
    expect(editor.copy).toHaveBeenCalledExactlyOnceWith("r1");
  });
});

let seen: RowEditor<string>;
let options: RowEditorOptions<string> = {};
function Probe() {
  seen = useRowEditor<string>(options);
  return null;
}

describe("useRowEditor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    options = {};
  });

  it("starts with no row picked", () => {
    renderToStaticMarkup(createElement(Probe));
    expect(seen.editing).toBeUndefined();
    expect(seen.copying).toBeUndefined();
    expect(seen.formRef.current).toBeNull();
  });

  it("loads the row, clears the errors, then reveals the form", () => {
    const calls: string[] = [];
    vi.stubGlobal("requestAnimationFrame", () => calls.push("reveal"));
    options = {
      load: (row, copying) => calls.push(`load ${row} ${copying}`),
      clear: () => calls.push("clear"),
    };
    renderToStaticMarkup(createElement(Probe));
    seen.edit("r1");
    seen.copy("r2");
    expect(calls).toEqual(["load r1 false", "clear", "reveal", "load r2 true", "clear", "reveal"]);
  });
});

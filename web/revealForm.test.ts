import { describe, expect, it, vi } from "vitest";
import { openCard, type RevealTarget, showForm } from "./revealForm.ts";

/** A form in a card. */
function setup(options: { collapsed?: boolean; fields?: boolean } = {}) {
  const field = { focus: vi.fn() };
  const toggle = {
    getAttribute: () => (options.collapsed ? "false" : "true"),
    click: vi.fn(),
  };
  const card = { querySelector: () => toggle, scrollIntoView: vi.fn() };
  const form = {
    closest: () => card,
    querySelector: () => (options.fields === false ? null : field),
    scrollIntoView: vi.fn(),
  };
  return { field, toggle, card, formScroll: form.scrollIntoView, form: form as RevealTarget };
}

describe("openCard (AC-89)", () => {
  it("opens a folded card and says so", () => {
    const { toggle, form } = setup({ collapsed: true });
    expect(openCard(form)).toBe(true);
    expect(toggle.click).toHaveBeenCalledOnce();
  });

  it("leaves an open card alone", () => {
    const { toggle, form } = setup();
    expect(openCard(form)).toBe(false);
    expect(toggle.click).not.toHaveBeenCalled();
  });
});

describe("showForm (AC-89)", () => {
  it("focuses the first field and scrolls the card to its top", () => {
    const { card, field, form } = setup();
    showForm(form, "card", false);
    expect(field.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(card.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
  });

  it("scrolls the form itself, the least it takes, when the scope is the form", () => {
    const { card, form, formScroll } = setup();
    showForm(form, "form", false);
    expect(formScroll).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" });
    expect(card.scrollIntoView).not.toHaveBeenCalled();
  });

  it("scrolls instantly when the user asks for less motion", () => {
    const { card, form } = setup();
    showForm(form, "card", true);
    expect(card.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "instant" });
  });

  it("still scrolls a form that has no field", () => {
    const { card, form } = setup({ fields: false });
    showForm(form, "card", false);
    expect(card.scrollIntoView).toHaveBeenCalledOnce();
  });
});

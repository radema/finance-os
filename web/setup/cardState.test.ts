import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cardKey, readOpen, writeOpen } from "./cardState.ts";
import { Card } from "./ui.tsx";

const fakeStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
};

afterEach(() => vi.unstubAllGlobals());

describe("card memory", () => {
  it("is keyed by screen and card title, ignoring the query part of the hash", () => {
    expect(cardKey("#/pension?x=1", "Flows")).toBe(cardKey("#/pension", "Flows"));
    expect(cardKey("#/pension", "Flows")).not.toBe(cardKey("#/independence", "Flows"));
    expect(cardKey("#/pension", "Flows")).not.toBe(cardKey("#/pension", "Inputs"));
  });

  it("defaults to open and remembers only a closed card", () => {
    const storage = fakeStorage();
    const key = cardKey("#/pension", "Flows");
    expect(readOpen(storage, key)).toBe(true);
    writeOpen(storage, key, false);
    expect(readOpen(storage, key)).toBe(false);
    writeOpen(storage, key, true);
    expect(readOpen(storage, key)).toBe(true);
    expect(storage.data.size).toBe(0);
  });

  it("treats missing or throwing storage as open", () => {
    const key = cardKey("#/pension", "Flows");
    expect(readOpen(undefined, key)).toBe(true);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    expect(readOpen(broken, key)).toBe(true);
    expect(() => writeOpen(broken, key, false)).not.toThrow();
  });
});

describe("Card", () => {
  const render = (
    hash: string,
    storage: ReturnType<typeof fakeStorage>,
    title: ReactNode = "Flows",
    memoryKey?: string,
  ) => {
    vi.stubGlobal("window", { location: { hash }, localStorage: storage });
    // biome-ignore lint/correctness/noChildrenProp: `children` is a required prop and createElement's third argument does not satisfy it
    return renderToStaticMarkup(createElement(Card, { title, memoryKey, children: "body text" }));
  };

  it("renders open by default: a toggle button names the title, controls the body", () => {
    const html = render("#/pension", fakeStorage());
    expect(html).toMatch(/<button[^>]*type="button"[^>]*aria-expanded="true"/);
    const controls = /aria-controls="([^"]+)"/.exec(html)?.[1];
    const labelled = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`id="${controls}"`);
    expect(html).toMatch(new RegExp(`id="${labelled}"[^>]*>Flows<`));
    expect(html).not.toMatch(/class="card-body"[^>]*hidden/);
    expect(html).toContain("body text");
  });

  it("renders closed on the screen where it was closed, and open on another screen", () => {
    const storage = fakeStorage();
    writeOpen(storage, cardKey("#/pension", "Flows"), false);
    const closed = render("#/pension", storage);
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toMatch(/<div[^>]*class="card-body"[^>]*hidden/);
    expect(render("#/independence", storage)).toContain('aria-expanded="true"');
  });

  it("uses memoryKey when the title is not a string", () => {
    const storage = fakeStorage();
    writeOpen(storage, cardKey("#/goals/detail", "mc"), false);
    const html = render(
      "#/goals/detail",
      storage,
      createElement("span", null, "Monte Carlo"),
      "mc",
    );
    expect(html).toContain('aria-expanded="false"');
  });
});

import { init } from "echarts/core";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { buildOption } from "./TimeChart.tsx";

beforeAll(() => {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  vi.stubGlobal("document", { documentElement: {}, createElement: () => false });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "currentcolor" }));
});
afterAll(() => vi.unstubAllGlobals());

it("keeps nearby goal-history end labels visible, ordered and apart", () => {
  const names = ["New car", "Home deposit", "Retirement"];
  const chart = init(null as never, undefined, {
    renderer: "svg",
    ssr: true,
    width: 731,
    height: 320,
  });
  chart.setOption(
    buildOption(
      ["2026-01", "2026-02"],
      names.map((name, i) => ({
        name,
        colour: "--slot1",
        data: [100, 100 - i],
        endLabel: true,
      })),
      String,
      true,
    ),
  );
  const labels = chart
    .getZr()
    .storage.getDisplayList(true)
    .flatMap((el) => {
      const text = (el as { style?: { text?: string } }).style?.text;
      if (!text || !names.includes(text.replaceAll("\n", " "))) return [];
      const box = el.getBoundingRect().clone();
      const transform = el.getComputedTransform();
      if (transform) box.applyTransform(transform);
      return [{ text: text.replaceAll("\n", " "), box }];
    });
  expect(labels).toHaveLength(3);
  const boxes = names.map((name) => {
    const label = labels.find((item) => item.text === name);
    if (!label) throw new Error(`Missing label: ${name}`);
    return label.box;
  });
  for (const box of boxes) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(731);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(320);
  }
  expect(boxes[0].y + boxes[0].height).toBeLessThanOrEqual(boxes[1].y);
  expect(boxes[1].y + boxes[1].height).toBeLessThanOrEqual(boxes[2].y);
  chart.dispose();
});

it("wraps a long goal name within the chart", () => {
  const name = "A long retirement goal name that must remain fully visible";
  const chart = init(null as never, undefined, {
    renderer: "svg",
    ssr: true,
    width: 731,
    height: 320,
  });
  chart.setOption(
    buildOption(
      ["2026-01", "2026-02"],
      [{ name, colour: "--slot1", data: [10, 20], endLabel: true }],
      String,
      true,
    ),
  );
  const lines = chart
    .getZr()
    .storage.getDisplayList(true)
    .flatMap((el) => {
      const text = (el as { style?: { text?: string } }).style?.text;
      if (!text || !name.includes(text.trim()) || !text.trim()) return [];
      const box = el.getBoundingRect().clone();
      const transform = el.getComputedTransform();
      if (transform) box.applyTransform(transform);
      return [{ text, box }];
    });
  expect(lines.map(({ text }) => text).join("")).toBe(name);
  expect(lines.length).toBeGreaterThan(1);
  for (const { box } of lines) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(731);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(320);
  }
  chart.dispose();
});

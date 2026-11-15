import { type EChartsCoreOption, init } from "echarts/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FanPoint, SeriesPoint } from "../../engine/goalViews.ts";
import { buildOption as buildFan } from "./FanChart.tsx";
import { buildOption as buildRange } from "./RangeChart.tsx";
import { buildOption as buildValue } from "./ValueChart.tsx";

/** Font size of the end labels: two labels closer than this overprint. */
const LABEL_HEIGHT = 13;

beforeAll(() => {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  // No canvas in node: zrender then measures text from its built-in width table.
  vi.stubGlobal("document", { documentElement: {}, createElement: () => false });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "currentcolor" }));
});
afterAll(() => vi.unstubAllGlobals());

const hasZeroTick = (texts: [string, number][]) => texts.some(([text]) => /^0\s€$/.test(text));

/** Draws the option server-side and returns the SVG text elements as `[text, y]`. */
function draw(option: EChartsCoreOption): [string, number][] {
  const chart = init(null as never, undefined, {
    renderer: "svg",
    ssr: true,
    width: 900,
    height: 320,
  });
  chart.setOption(option);
  const svg = chart.renderToSVGString();
  chart.dispose();
  return [...svg.matchAll(/translate\([\d.]+ (-?[\d.]+)\)"[^>]*>([^<]+)<\/text>/g)].map((match) => [
    match[2] as string,
    Number(match[1]),
  ]);
}

const yOf = (texts: [string, number][], start: string) =>
  (texts.find(([text]) => text.startsWith(start)) as [string, number])[1];

function fanLabelGaps(fan: FanPoint[]) {
  const texts = draw(buildFan(fan, 16_000, 2));
  const [good, typical, bad] = ["Good case", "Typical case", "Bad case"].map((name) =>
    yOf(texts, name),
  ) as [number, number, number];
  return { typicalBelowGood: typical - good, badBelowTypical: bad - typical };
}

describe("end labels of the goal charts", () => {
  it("keeps extreme-value outcome labels inside their charts without overlap", () => {
    const fan = [
      { year: 2026, bad: 19_000, typical: 19_000, good: 19_000 },
      { year: 2046, bad: 217_614, typical: 309_045, good: 444_439 },
    ];
    const target = 1_490_859_775;
    const range = { bad: 217_614, typical: 309_045, good: 444_439, target };
    const options = [
      buildFan(fan, target, 2),
      buildRange(range, { min: 100_000, max: 1_491_000_000, counts: [1, 0] }, 2),
    ];
    for (const option of options) {
      const chart = init(null as never, undefined, {
        renderer: "svg",
        ssr: true,
        width: 731,
        height: 320,
      });
      chart.setOption(option);
      const labels = chart
        .getZr()
        .storage.getDisplayList(true)
        .flatMap((el) => {
          const text = (el as { style?: { text?: string } }).style?.text;
          if (!text || !/^(Good case|Bad case|Typical case|Target)/.test(text)) return [];
          const box = el.getBoundingRect().clone();
          const transform = el.getComputedTransform();
          if (transform) box.applyTransform(transform);
          return [{ text, box }];
        });
      expect(labels).toHaveLength(4);
      for (const { text, box } of labels) {
        expect(box.x, text).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, text).toBeLessThanOrEqual(731);
        expect(box.y + box.height, text).toBeLessThanOrEqual(320);
      }
      for (let i = 0; i < labels.length; i++)
        for (let j = i + 1; j < labels.length; j++) {
          const a = labels[i].box;
          const b = labels[j].box;
          expect(
            a.x < b.x + b.width &&
              a.x + a.width > b.x &&
              a.y < b.y + b.height &&
              a.y + a.height > b.y,
            `${labels[i].text} / ${labels[j].text}`,
          ).toBe(false);
        }
      chart.dispose();
    }
  });
  it("fan chart: good 16,343, typical 15,929 and bad 15,517 do not overlap", () => {
    const gaps = fanLabelGaps([
      { year: 2026, bad: 12_000, typical: 12_000, good: 12_000 },
      { year: 2027, bad: 13_500, typical: 14_000, good: 14_800 },
      { year: 2028, bad: 15_517, typical: 15_929, good: 16_343 },
    ]);
    expect(gaps.typicalBelowGood).toBeGreaterThanOrEqual(LABEL_HEIGHT);
    expect(gaps.badBelowTypical).toBeGreaterThanOrEqual(LABEL_HEIGHT);
  });

  it("fan chart: labels 21 euros apart do not overlap and keep their order", () => {
    const gaps = fanLabelGaps([
      { year: 2026, bad: 15_000, typical: 15_000, good: 15_000 },
      { year: 2027, bad: 15_900, typical: 15_929, good: 15_950 },
    ]);
    expect(gaps.typicalBelowGood).toBeGreaterThanOrEqual(LABEL_HEIGHT);
    expect(gaps.badBelowTypical).toBeGreaterThanOrEqual(LABEL_HEIGHT);
  });

  it("fan chart: the value axis does not start at 0 for 15,000 to 16,343", () => {
    const texts = draw(
      buildFan(
        [
          { year: 2026, bad: 15_000, typical: 15_000, good: 15_000 },
          { year: 2027, bad: 15_517, typical: 15_929, good: 16_343 },
        ],
        16_000,
        2,
      ),
    );
    expect(hasZeroTick(texts)).toBe(false);
  });

  it("value chart: Value and Money put in end at the same amount without overlap", () => {
    const points: SeriesPoint[] = ["2026-01", "2026-02", "2026-03"].map((month, index) => ({
      month,
      value: 1_500 + index * 150,
      moneyIn: 1_500 + index * 150,
    }));
    const texts = draw(buildValue(points, 2));
    expect(Math.abs(yOf(texts, "Value") - yOf(texts, "Money put in"))).toBeGreaterThanOrEqual(
      LABEL_HEIGHT,
    );
    expect(hasZeroTick(texts)).toBe(false);
  });
});

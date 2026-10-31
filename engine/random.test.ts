import { describe, expect, it } from "vitest";
import { fillNormals, pathRandom } from "./random.ts";

describe("pathRandom", () => {
  it("repeats for the same seed and path, and differs for another seed or path (AC-52)", () => {
    const draw = (seed: number, path: number) => {
      const random = pathRandom(seed, path);
      return [random(), random(), random()];
    };
    expect(draw(42, 0)).toEqual(draw(42, 0));
    expect(draw(42, 0)).not.toEqual(draw(43, 0));
    expect(draw(42, 0)).not.toEqual(draw(42, 1));
    expect(draw(1, 0)).not.toEqual(draw(1 + 2 ** 32, 0));
  });

  it("stays in [0, 1) with mean 1/2", () => {
    const random = pathRandom(7, 3);
    let sum = 0;
    for (let i = 0; i < 20_000; i++) {
      const u = random();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      sum += u;
    }
    expect(sum / 20_000).toBeCloseTo(0.5, 1);
  });
});

describe("fillNormals", () => {
  it("gives mean 0, variance 1 and no correlation between neighbours", () => {
    const n = 40_000;
    const z = new Float64Array(n);
    fillNormals(pathRandom(1, 0), z);
    let sum = 0;
    let sumSq = 0;
    let cross = 0;
    for (let i = 0; i < n; i++) {
      const v = z[i] as number;
      sum += v;
      sumSq += v * v;
      if (i > 0) cross += v * (z[i - 1] as number);
    }
    expect(sum / n).toBeCloseTo(0, 1);
    expect(sumSq / n).toBeCloseTo(1, 1);
    expect(cross / n).toBeCloseTo(0, 1);
  });
});

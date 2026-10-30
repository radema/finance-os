import { describe, expect, it } from "vitest";
import { cholesky, shrinkToPositiveDefinite } from "./correlation.ts";

const times = (a: number[][], b: number[][]) =>
  a.map((row) => b[0]?.map((_, j) => row.reduce((s, v, k) => s + v * (b[k]?.[j] ?? 0), 0)) ?? []);
const transpose = (m: number[][]) => m[0]?.map((_, j) => m.map((row) => row[j] as number)) ?? [];

const SAMPLE = [
  [1, 0, 0.3, 0.85, 0, 0.1],
  [0, 1, 0.6, 0.4, 0, 0.2],
  [0.3, 0.6, 1, 0.55, 0, 0.1],
  [0.85, 0.4, 0.55, 1, 0, 0.15],
  [0, 0, 0, 0, 1, 0],
  [0.1, 0.2, 0.1, 0.15, 0, 1],
];
// Equity and Govt bonds at +0.9, Govt bonds and Corp bonds at +0.9, but Equity and Corp bonds at -0.9:
// not a possible set of correlations.
const IMPOSSIBLE = [
  [1, 0.9, -0.9],
  [0.9, 1, 0.9],
  [-0.9, 0.9, 1],
];

describe("cholesky", () => {
  it("factors a positive-definite matrix: L Lᵀ gives the matrix back", () => {
    const lower = cholesky(SAMPLE);
    expect(lower).not.toBeNull();
    const back = times(lower as number[][], transpose(lower as number[][]));
    for (const [i, row] of SAMPLE.entries()) {
      for (const [j, value] of row.entries()) expect(back[i]?.[j]).toBeCloseTo(value, 12);
    }
  });

  it("returns null when the matrix is not positive definite", () => {
    expect(cholesky(IMPOSSIBLE)).toBeNull();
  });
});

describe("shrinkToPositiveDefinite", () => {
  it("returns a positive-definite matrix unchanged and not flagged", () => {
    expect(shrinkToPositiveDefinite(SAMPLE)).toEqual({ matrix: SAMPLE, shrunk: false });
  });

  it("shrinks the off-diagonals in 10% steps until it factors, and flags it", () => {
    const { matrix, shrunk } = shrinkToPositiveDefinite(IMPOSSIBLE);
    expect(shrunk).toBe(true);
    expect(cholesky(matrix)).not.toBeNull();
    // The result is the original times 0.9^k, and step k-1 still failed.
    const k = Math.round(Math.log((matrix[0]?.[1] as number) / 0.9) / Math.log(0.9));
    const at = (steps: number) =>
      IMPOSSIBLE.map((row, i) => row.map((v, j) => (i === j ? v : v * 0.9 ** steps)));
    expect(k).toBeGreaterThan(0);
    for (const [i, row] of at(k).entries()) {
      for (const [j, value] of row.entries()) expect(matrix[i]?.[j]).toBeCloseTo(value, 12);
    }
    expect(cholesky(at(k - 1))).toBeNull();
    expect(matrix.map((row, i) => row[i])).toEqual([1, 1, 1]);
  });

  it("does not change its input", () => {
    const input = IMPOSSIBLE.map((row) => [...row]);
    shrinkToPositiveDefinite(input);
    expect(input).toEqual(IMPOSSIBLE);
  });
});

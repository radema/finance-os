// A pivot at or below this is treated as zero: the matrix is not positive definite.
const PIVOT_FLOOR = 1e-10;
const SHRINK_FACTOR = 0.9;
// 0.9^200 is about 7e-10: off-diagonals that small leave the identity, which always factorises.
const MAX_SHRINK_STEPS = 200;

/**
 * Cholesky factor of a symmetric matrix.
 *
 * @param matrix Square, symmetric matrix.
 * @returns The lower-triangular `L` with `L Lᵀ = matrix`, or `null` when the matrix is not positive definite.
 */
export function cholesky(matrix: readonly (readonly number[])[]): number[][] | null {
  const n = matrix.length;
  const lower = matrix.map(() => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = matrix[i]?.[j] ?? 0;
      for (let k = 0; k < j; k++) sum -= (lower[i]?.[k] ?? 0) * (lower[j]?.[k] ?? 0);
      const row = lower[i] as number[];
      if (i === j) {
        if (sum <= PIVOT_FLOOR) return null;
        row[j] = Math.sqrt(sum);
      } else {
        row[j] = sum / (lower[j]?.[j] as number);
      }
    }
  }
  return lower;
}

/**
 * Makes a correlation matrix usable for simulation: while it is not positive definite, multiplies
 * every off-diagonal by 0.9. A positive-definite matrix comes back unchanged.
 *
 * @param matrix Square, symmetric correlation matrix.
 * @returns The matrix the engine will use, and `shrunk`: whether any shrinking was needed.
 */
export function shrinkToPositiveDefinite(matrix: readonly (readonly number[])[]): {
  matrix: number[][];
  shrunk: boolean;
} {
  let current = matrix.map((row) => [...row]);
  for (let step = 0; step < MAX_SHRINK_STEPS; step++) {
    if (cholesky(current)) return { matrix: current, shrunk: step > 0 };
    current = current.map((row, i) =>
      row.map((value, j) => (i === j ? value : value * SHRINK_FACTOR)),
    );
  }
  return { matrix: current.map((row, i) => row.map((_, j) => (i === j ? 1 : 0))), shrunk: true };
}

/* Shared by the import check (server) and the current-portfolio form (UI). */
/** Units split by weights with integer units by largest remainder (ticket 08). Fractional quantities are split in steps of 0.0001. */
export function splitByWeights(total: number, ws: { goalId: string; w: number }[]): { goalId: string; units: number }[] {
  const scale = Number.isInteger(total) ? 1 : 1e4, T = Math.round(total * scale), sum = ws.reduce((a, x) => a + x.w, 0) || 1;
  const raw = ws.map(x => ({ goalId: x.goalId, exact: T * (x.w || 0) / sum }));
  const parts = raw.map(r => ({ goalId: r.goalId, n: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }));
  let left = T - parts.reduce((a, p) => a + p.n, 0);
  for (const p of [...parts].sort((a, b) => b.rem - a.rem)) { if (left <= 0) break; p.n++; left--; }
  return parts.filter(p => p.n > 0).map(p => ({ goalId: p.goalId, units: p.n / scale }));
}

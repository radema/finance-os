/* Ticket 08 checks on the synthetic Fineco file: 9 rows, none lost to the metadata block, one coupon; duplicates, opening skip, split rule. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sampleState } from '../src/engine/sample.ts';
import { checkRows, parseFineco, planCommit } from '../src/server/import/fineco.ts';
import { splitByWeights } from '../src/shared/split.ts';

const parsed = parseFineco(readFileSync('public/fixtures/fineco-movimenti-synthetic.xlsx'));
const st = sampleState();

describe('Fineco XLSX preset', () => {
  it('finds the header on row 6 and reads 9 rows: 7 trades (6 A, 1 V counted with the others) and 1 coupon', () => {
    expect(parsed.headerRow).toBe(6);
    expect(parsed.rows).toHaveLength(9);
    expect(parsed.rows.filter(r => r.kind === 'coupon')).toHaveLength(1);
    expect(parsed.rows.filter(r => r.side === 'V')).toHaveLength(1);
  });
  it('classifies rows: duplicate, before opening, unknown product, needs a goal, ready', () => {
    const s = checkRows(st, parsed.rows, '2024-01-02').map(c => c.state);
    expect(s).toEqual(['needs_goal', 'needs_goal', 'needs_goal', 'ready', 'ready', 'ready', 'duplicate', 'before_opening', 'unknown_product']);
  });
  it('a split must add up to the broker quantity: 3 + 4 of 8 is refused, 3 + 5 is accepted', () => {
    const checks = checkRows(st, parsed.rows, '2024-01-02');
    const bad = planCommit(checks, [{ n: 8, mode: 'units', parts: [{ goalId: 'g3', units: 3 }, { goalId: 'g5', units: 4 }] }]);
    expect(bad.errors[0]).toMatch(/do not add up/);
    const ok = planCommit(checks, [{ n: 8, mode: 'units', parts: [{ goalId: 'g3', units: 3 }, { goalId: 'g5', units: 5 }] }]);
    expect(ok.tx.filter(t => t.productId === 'p6').map(t => t.qty)).toEqual([3, 5]);
    expect(ok.tx.filter(t => t.productId === 'p6').reduce((a, t) => a + (t.commission ?? 0), 0)).toBeCloseTo(2.95, 10);
  });
  it('a coupon is stored as the cash received, with no units', () => {
    const p = planCommit(checkRows(st, parsed.rows, '2024-01-02'), []);
    const c = p.tx.find(t => t.type === 'coupon')!;
    expect(c.amount).toBeCloseTo(218.75, 2); expect(c.qty).toBe(0);
  });
});
describe('largest remainder split', () => {
  it('10 units by weights 0.5 / 0.5 / 0.5 gives 4 / 3 / 3 in the order of the largest remainder', () => {
    const s = splitByWeights(10, [{ goalId: 'a', w: 1 }, { goalId: 'b', w: 1 }, { goalId: 'c', w: 1 }]);
    expect(s.reduce((a, x) => a + x.units, 0)).toBe(10);
    expect(s.map(x => x.units).sort()).toEqual([3, 3, 4]);
  });
});

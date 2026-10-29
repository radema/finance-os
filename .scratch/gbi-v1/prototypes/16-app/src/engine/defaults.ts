/* Defaults for a new database (source spec: Settings, FireSettings, Pension, CashFlow). Ticket 07: includePension true. */
import type { CashFlowIn, Pension, Settings } from './types.ts';

export const defaultSettings = (): Settings => ({
  inflation: 0.02, taxStd: 0.26, taxGovt: 0.125, bollo: 0.002, pensionTax: 0.20, paths: 1000, seed: 42, probNeed: 0.90, probWant: 0.75, probWish: 0.50,
  zainetto: { amount: 0, expiry: 2029, goalId: '' }, commission: { rate: 0.0019, min: 2.95, max: 19 }, trackingStart: new Date().toISOString().slice(0, 7), behindMonths: 3, staleDays: 7,
  fire: { efFromGoal: '', efMonths: 12, l2Mult: 300, l3Mult: 200, includePension: true }
});
export const defaultCorr = (): number[][] => [[1, 0, .3, .85, 0, .1], [0, 1, .6, .4, 0, .2], [.3, .6, 1, .55, 0, .1], [.85, .4, .55, 1, 0, .15], [0, 0, 0, 0, 1, 0], [.1, .2, .1, .15, 0, 1]];
export const defaultPension = (): Pension => ({ ral: 0, ralGrowth: 0.02, tfrPct: 0.0691, workerPct: 0.01, employerPct: 0.014, voluntary: null, marginal: 0.33, firstYear: new Date().getFullYear(), cap: 5300, extra: 0, goalId: '', flows: [] });
export const defaultCashflow = (): CashFlowIn => ({ income: 0, incomeGrowth: 0.02, essential: 0, optional: 0, expenseGrowth: 0.02, events: [] });

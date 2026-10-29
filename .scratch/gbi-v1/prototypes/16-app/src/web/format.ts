/* en-GB formatting as in prototype 11 (the real app localises to it-IT). */
export const eur = (n: number): string => (n < 0 ? '−' : '') + '€' + Math.abs(Math.round(n)).toLocaleString('en-GB');
export const eur2 = (n: number): string => (n < 0 ? '−' : '') + '€' + Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function eurK(n: number): string {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (a >= 1e6) return s + '€' + (a / 1e6).toFixed(a >= 1e7 ? 0 : 2).replace(/\.?0+$/, '') + 'm';
  if (a >= 1e4) return s + '€' + Math.round(a / 1e3) + 'k';
  if (a >= 1e3) return s + '€' + (a / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return s + '€' + Math.round(a);
}
export const pct = (p: number, d = 0): string => (p * 100).toFixed(d) + '%';
export const sgn = (p: number, d = 1): string => (p >= 0 ? '+' : '−') + (Math.abs(p) * 100).toFixed(d) + '%';
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dt = (iso: string): string => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MON[m - 1]} ${y}`; };
export const dtShort = (iso: string): string => { const [, m, d] = iso.split('-').map(Number); return `${d} ${MON[m - 1]}`; };
export const monthLabel = (v: string): string => { const [y, m] = v.split('-'); return MON[+m - 1] + ' ' + y.slice(2); };
export const num = (n: number, d = 4): string => n.toLocaleString('en-GB', { maximumFractionDigits: d });
export const niceMax = (v: number): number => { const m = Math.pow(10, Math.floor(Math.log10(v))), st = m / 2; return Math.ceil(v / st) * st; };
export const ageText = (age: number): string => (age <= 1 ? (age === 0 ? 'today' : 'yesterday') : `${age} days old`);

// Month helpers. A month is `YYYY-MM`; a date is `YYYY-MM-DD`.

const pad = (n: number) => String(n).padStart(2, "0");

/** The last calendar day of a month. */
export function monthEnd(month: string): string {
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
  return `${month}-${pad(lastDay.getUTCDate())}`;
}

/** The month `count` months after `month` (before it when `count` is negative). */
export function addMonths(month: string, count: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + count;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** The `count` months that end at `last`, oldest first. */
export function monthsEnding(last: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(last, i + 1 - count));
}

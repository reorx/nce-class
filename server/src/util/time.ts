// Demo reference "today" so relative labels stay stable across machine clocks.
// The M1 mock data & goal screenshots were produced against 2026-07-01.
export const REFERENCE_TODAY = '2026-07-01';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function toUTC(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function weekdayCN(dateStr: string): string {
  return WEEKDAYS[toUTC(dateStr).getUTCDay()];
}

/** Whole-day difference (a - b) in days. */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUTC(a).getTime() - toUTC(b).getTime()) / 86400000);
}

export function relativeDayCN(dateStr: string, today = REFERENCE_TODAY): string {
  const diff = daysBetween(today, dateStr);
  if (diff <= 0) return '今天';
  if (diff === 1) return '昨天';
  return `${diff} 天前`;
}

/** Real local today (YYYY-MM-DD) — for billing/账务 paths. NOT REFERENCE_TODAY,
 *  which only serves display-layer relative labels on demo data. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** minutes -> "Xh0Ym" e.g. 118 -> "1h58m" */
export function fmtDuration(min: number): string {
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}m`;
}

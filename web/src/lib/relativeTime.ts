// 「上次上课」相对时间：今天的课用小时粒度（3小时前/刚刚），更早的按自然日
// 粒度（昨天/2天前）。startedAt 是浏览器本地 naive 'YYYY-MM-DD HH:mm:ss'
// （classroomStore 提交时的墙钟时间），所以直接和浏览器本地 now 比较。
// server 端的 relative 字段基于固定的 REFERENCE_TODAY，仅作 legacy 兜底。

function parseNaive(s: string): Date {
  const [date, time] = s.split(' ');
  const [y, m, d] = date.split('-').map(Number);
  const [hh = 0, mm = 0, ss = 0] = (time ?? '').split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, ss);
}

/** 自然日差（now 所在日 − t 所在日），本地时区。 */
function calendarDaysAgo(t: Date, now: Date): number {
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const b = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

export function relativeSessionLabel(startedAt: string | null, now = new Date()): string | null {
  if (!startedAt) return null;
  const t = parseNaive(startedAt);
  const days = calendarDaysAgo(t, now);
  if (days <= 0) {
    const hours = Math.floor((now.getTime() - t.getTime()) / 3600000);
    return hours >= 1 ? `${hours}小时前` : '刚刚';
  }
  if (days === 1) return '昨天';
  return `${days}天前`;
}

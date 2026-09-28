// 服务端 SQLite datetime('now') 写入的时间戳（paid_at / snapshot_at / created_at）
// 是 UTC 'YYYY-MM-DD HH:MM:SS'，不带时区标记。显示前按 UTC 解析，再用浏览器
// 本地时区格式化。注意课堂的 started_at / 事件 createdAt 是浏览器本地墙钟，不走这里。

const pad = (n: number) => String(n).padStart(2, '0');

function parseUtc(s: string): Date {
  return new Date(`${s.replace(' ', 'T')}Z`);
}

/** 'YYYY-MM-DD' in local time. */
export function utcToLocalDate(s: string): string {
  const d = parseUtc(s);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'MM-DD HH:mm' in local time. */
export function utcToLocalMinute(s: string): string {
  const d = parseUtc(s);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

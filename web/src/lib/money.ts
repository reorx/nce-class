// 金额换算：存储与 API 一律整数分，元 ↔ 分只在 web 表单/展示层发生（plan 决策）。

/** 分 → 元字符串（无符号、无千分位）：10000→'100'，9950→'99.5'，3→'0.03'。 */
export function centsToYuan(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  if (fen === 0) return `${sign}${yuan}`;
  const frac = fen % 10 === 0 ? String(fen / 10) : String(fen).padStart(2, '0');
  return `${sign}${yuan}.${frac}`;
}

/** 元输入 → 分；仅接受非负、至多两位小数的普通数字，其余 → null。 */
export function yuanToCents(input: string): number | null {
  const s = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0') || '0');
}

/** 展示金额：'¥13,720' / '¥99.5'。 */
export function fmtMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const yuan = Math.floor(abs / 100);
  const fenPart = centsToYuan(abs % 100); // '0' | '0.5' 之类
  const frac = abs % 100 === 0 ? '' : fenPart.slice(1); // '.5' / '.03'
  return `${sign}¥${yuan.toLocaleString('en-US')}${frac}`;
}

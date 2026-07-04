// 课堂战报（Recap 卡片）展示用的纯派生逻辑，配合 components/RecapCard.tsx。
// 设计稿：claude design「Recap 页面.dc.html」。

import type { RecapGroup } from './api';

/** 个人表现数据；不传给 RecapCard 即为「非个人」模式（隐藏个人卡）。 */
export interface RecapPersonal {
  name: string;
  attended: boolean;
  groupName: string | null;
  groupEmoji: string | null;
  personalScore: number;
  recitation: string; // '已背完' | '背完部分' | '没背' | '未检查'
  homework: string; // '完成' | '没交'
}

/** 领奖台排列：第一名居中，其余从中心向两侧交替（输入按名次降序）。 */
export function podium<T>(sorted: T[]): T[] {
  const res: T[] = [];
  sorted.forEach((x, i) => {
    if (i % 2 === 1) res.unshift(x);
    else res.push(x);
  });
  return res;
}

const WINNER_H = 92;
const MIN_H = 36;

export interface GroupBar {
  name: string;
  emoji: string | null;
  score: number;
  winner: boolean;
  height: number;
}

/** 各组得分柱：降序排名（同分按 orderIndex 稳定）→ 领奖台排列，冠军柱最高。 */
export function groupBars(groups: RecapGroup[]): GroupBar[] {
  if (groups.length === 0) return [];
  const sorted = [...groups].sort((a, b) => b.score - a.score || a.orderIndex - b.orderIndex);
  const top = sorted[0].score;
  const bars = sorted.map((g) => {
    const winner = g.score === top;
    const height = winner
      ? WINNER_H
      : top > 0
        ? Math.max(MIN_H, Math.min(80, Math.round(24 + (Math.max(0, g.score) / top) * 48)))
        : 44;
    return { name: g.name, emoji: g.emoji, score: g.score, winner, height };
  });
  return podium(bars);
}

/** minutes → "1小时52分" / "1小时" / "45分钟"。 */
export function fmtDurationCn(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}分钟`;
  return m === 0 ? `${h}小时` : `${h}小时${m}分`;
}

/** ('2026', '07-03') → "2026.07.03"；缺年份时 → "07.03"。 */
export function dateLabel(year: string | null | undefined, md: string): string {
  const d = md.replace('-', '.');
  return year ? `${year}.${d}` : d;
}

export function fmtSigned(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

/** 检查状态 → 颜色档位（与小程序端 recapView 口径一致）。 */
export type StatusTone = 'good' | 'part' | 'bad' | 'muted';

export function homeworkTone(status: string): StatusTone {
  return status === '完成' ? 'good' : 'muted';
}

export function recitationTone(status: string): StatusTone {
  if (status === '已背完') return 'good';
  if (status === '背完部分') return 'part';
  if (status === '没背') return 'bad';
  return 'muted';
}

const TONE_COLOR: Record<StatusTone, string> = {
  good: '#3a7a4e',
  part: '#a87f24',
  bad: '#a04a42',
  muted: '#8a7f63',
};

export const toneColor = (t: StatusTone) => TONE_COLOR[t];

// recap 展示用的纯派生逻辑，配合 components/RecapView.tsx。

/** 排名奖牌：并列分数共享名次（1224 式）。 */
export function medals(scores: number[]): string[] {
  const MEDAL = ['🥇', '🥈', '🥉'];
  let rank = 0;
  return scores.map((s, i) => {
    if (i > 0 && s === scores[i - 1]) return rank < 3 ? MEDAL[rank - 1] : '';
    rank = i + 1;
    return rank <= 3 ? MEDAL[rank - 1] : '';
  });
}

/** 检查状态 → 颜色档位（对齐 PRD §8 配色：绿/黄/红/灰）。 */
export type StatusTone = 'good' | 'part' | 'bad' | 'muted';

export function homeworkTone(status: string): StatusTone {
  if (status === '完成') return 'good';
  if (status === '需补') return 'part';
  return 'muted';
}

export function recitationTone(status: string): StatusTone {
  if (status === '已背完') return 'good';
  if (status === '背完部分') return 'part';
  if (status === '没背') return 'bad';
  return 'muted';
}

/** 个人分展示：+2⭐ / 0 / −1。 */
export function fmtScore(n: number): string {
  if (n > 0) return `+${n}⭐`;
  if (n < 0) return `${n}`;
  return '0';
}

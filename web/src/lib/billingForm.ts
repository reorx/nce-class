// 收款项表单（创建/重置共用弹窗）的纯派生逻辑。

/** 课程次数输入 → 正整数；空串/小数/非数字/≤0 → null。 */
export function parseLessonCount(s: string): number | null {
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 ? n : null;
}

/** 全勤口径的预售金额（分）/人；任一输入缺失 → null。 */
export function previewPerStudentCents(p: {
  lessonCount: number | null;
  unitPriceCents: number | null;
  addonCents: number | null;
}): number | null {
  if (p.lessonCount == null || p.unitPriceCents == null || p.addonCents == null) return null;
  return p.lessonCount * p.unitPriceCents + p.addonCents;
}

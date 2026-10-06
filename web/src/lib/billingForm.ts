// 收款项表单（创建/重置共用弹窗）的纯派生逻辑。

/** 创建收款项仅可选未归档班级；原选择失效时回退到首个可选班级。 */
export function billingClassSelection<T extends { id: string; isArchived: boolean }>(items: T[], currentId: string) {
  const classes = items.filter((c) => !c.isArchived);
  return { classes, classId: classes.some((c) => c.id === currentId) ? currentId : (classes[0]?.id ?? '') };
}

/** 课程次数输入 → 正整数；空串/小数/非数字/≤0 → null。 */
export function parseLessonCount(s: string): number | null {
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 ? n : null;
}

/** 每人应收（分）= 课程次数 × 单价 + 附加费；任一输入缺失 → null。 */
export function previewPerStudentCents(p: {
  lessonCount: number | null;
  unitPriceCents: number | null;
  addonCents: number | null;
}): number | null {
  if (p.lessonCount == null || p.unitPriceCents == null || p.addonCents == null) return null;
  return p.lessonCount * p.unitPriceCents + p.addonCents;
}

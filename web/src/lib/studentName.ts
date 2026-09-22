/**
 * 学生姓名口径：`name` = 英文名（必填、主显示名、头像首字母取它），
 * `cnName` = 中文名（可空，卡片/收款单/成长档案下方小字）。
 */
export interface StudentNameDraft {
  name: string;
  cnName: string;
}

export interface StudentNameLike {
  name: string;
  cnName?: string | null;
}

/** 校验并归一化弹窗草稿：英文名 trim 后为空 → error；中文名空白 → null（清空）。
 *  编辑弹窗与「添加学生」弹窗共用。 */
export function validateStudentNameForm(d: StudentNameDraft): { name: string; cnName: string | null } | { error: string } {
  const name = d.name.trim();
  if (!name) return { error: '学生姓名必填' };
  const cnName = d.cnName.trim();
  return { name, cnName: cnName || null };
}

/** 卡片/头部渲染用的主名 + 副名。副名在缺失、空白、或与主名相同时返回 null
 *  （避免 "Tom · Tom"）。头像首字母仍归 lib/theme.ts 的 initial()。 */
export function studentNamePair(s: StudentNameLike): { primary: string; secondary: string | null } {
  const cn = (s.cnName ?? '').trim();
  return { primary: s.name, secondary: cn && cn !== s.name.trim() ? cn : null };
}

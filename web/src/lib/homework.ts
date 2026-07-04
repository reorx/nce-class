// 作业布置 pure derivations: 教材册数表 + 课文复习级联默认值 + 作业模板变量替换.

export const BOOKS = [1, 2, 3, 4] as const;

// 每册课数。镜像 server/src/app.ts 的 BOOK_LESSON_COUNTS —— 改一处都要改两处。
export const BOOK_LESSON_COUNTS: Record<number, number> = { 1: 144, 2: 96, 3: 60, 4: 48 };

export const BOOK_LABELS: Record<number, string> = { 1: '第一册', 2: '第二册', 3: '第三册', 4: '第四册' };

/** 1..课数 for the 第几课 select; [] without a (known) book. */
export function lessonOptions(book: number | null): number[] {
  const count = book != null ? (BOOK_LESSON_COUNTS[book] ?? 0) : 0;
  return Array.from({ length: count }, (_, i) => i + 1);
}

/** Clamp a candidate 第几课 into the book's 1..课数 range; null when either side is missing. */
export function clampLesson(book: number | null, lesson: number | null): number | null {
  if (book == null || lesson == null) return null;
  const max = BOOK_LESSON_COUNTS[book];
  if (!max) return null;
  return Math.min(Math.max(1, Math.trunc(lesson)), max);
}

/** 'MM-DD' → '7月4日'; anything else passes through. */
export function fmtDateCn(md: string): string {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(md);
  return m ? `${Number(m[1])}月${Number(m[2])}日` : md;
}

export interface HomeworkVars {
  lessonNumber: number | null;
  date: string; // 'MM-DD' (Session.date)
  className: string;
}

/** Fill a class 作业模板: {lesson_number} / {date} / {class_name}; unknown placeholders stay. */
export function renderHomeworkTemplate(template: string, vars: HomeworkVars): string {
  return template
    .replaceAll('{lesson_number}', vars.lessonNumber != null ? String(vars.lessonNumber) : '')
    .replaceAll('{date}', fmtDateCn(vars.date))
    .replaceAll('{class_name}', vars.className);
}

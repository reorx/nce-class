// 作业布置 pure derivations: 教材表 + 课文复习级联默认值/文案 + 作业模板变量替换.

// 教材 key：'1'-'4' = 新概念英语第一~四册，starterA/starterB = 青少版入门级 A/B。
// 服务端存 TEXT 列，JSON 里恒为字符串。数组顺序即下拉顺序（由浅入深）。
export const BOOKS = ['starterA', 'starterB', '1', '2', '3', '4'] as const;
export type BookKey = (typeof BOOKS)[number];

// 每册课数。镜像 server/src/app.ts 的 BOOK_LESSON_COUNTS —— 改一处都要改两处。
export const BOOK_LESSON_COUNTS: Record<BookKey, number> = {
  starterA: 45,
  starterB: 45,
  '1': 144,
  '2': 96,
  '3': 60,
  '4': 48,
};

export const BOOK_LABELS: Record<BookKey, string> = {
  starterA: '青少版A',
  starterB: '青少版B',
  '1': '第一册',
  '2': '第二册',
  '3': '第三册',
  '4': '第四册',
};

// 按单元编排的教材：每单元课数（青少版 15 单元 × 3 课），课文复习显示成 Unit · Lesson。
const BOOK_UNIT_SIZE: Partial<Record<BookKey, number>> = { starterA: 3, starterB: 3 };

/** <select> value → 教材 key; '' (未设置) or anything unknown → null. */
export function parseBook(v: string): BookKey | null {
  return (BOOKS as readonly string[]).includes(v) ? (v as BookKey) : null;
}

/** 1..课数 for the 第几课 select; [] without a (known) book. */
export function lessonOptions(book: BookKey | null): number[] {
  const count = book != null ? (BOOK_LESSON_COUNTS[book] ?? 0) : 0;
  return Array.from({ length: count }, (_, i) => i + 1);
}

/** Clamp a candidate 第几课 into the book's 1..课数 range; null when either side is missing. */
export function clampLesson(book: BookKey | null, lesson: number | null): number | null {
  if (book == null || lesson == null) return null;
  const max = BOOK_LESSON_COUNTS[book];
  if (!max) return null;
  return Math.min(Math.max(1, Math.trunc(lesson)), max);
}

/** 课文复习的第 n 课（1-based 平铺序号）文案：按单元编排 → 'Unit 3 · Lesson 2'，其余 → '第7课'. */
export function reviewLessonLabel(book: BookKey, n: number): string {
  const unit = BOOK_UNIT_SIZE[book];
  return unit ? `Unit ${Math.ceil(n / unit)} · Lesson ${((n - 1) % unit) + 1}` : `第${n}课`;
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

// 排班日历编辑器的纯状态模型（grouping.ts 风格：操作返回新 state，UI 只做渲染）。
// 交互 = 时间刷：先选一个时间段刷子，再点日历日期上色；同天可多节（不同
// startTime），同刷再点取消，同 startTime 换 endTime 则替换（plan 决策 6）。

export interface TimeBrush {
  startTime: string; // HH:MM
  endTime: string; // HH:MM
}

export interface EditorLesson {
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
}

export interface EditorState {
  name: string;
  brushes: TimeBrush[];
  activeBrush: number; // index into brushes
  lessons: EditorLesson[];
  month: string; // 'YYYY-MM' currently shown
}

export const DEFAULT_BRUSHES: TimeBrush[] = [
  { startTime: '08:00', endTime: '10:00' },
  { startTime: '15:00', endTime: '17:00' },
];

const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidBrush(b: TimeBrush): boolean {
  return HM_RE.test(b.startTime) && HM_RE.test(b.endTime) && b.startTime < b.endTime;
}

/** 新建为空白 + 默认刷子；编辑已有周期则从其节次派生刷子与起始月份。 */
export function initEditor(p: { name?: string; lessons?: EditorLesson[]; today: string }): EditorState {
  const lessons = (p.lessons ?? []).slice();
  const pairs = new Map<string, TimeBrush>();
  for (const l of lessons) pairs.set(`${l.startTime}-${l.endTime}`, { startTime: l.startTime, endTime: l.endTime });
  const brushes = pairs.size
    ? [...pairs.values()].sort((a, b) => a.startTime.localeCompare(b.startTime))
    : DEFAULT_BRUSHES;
  const minDate = lessons.length ? lessons.map((l) => l.date).sort()[0] : p.today;
  return { name: p.name ?? '', brushes, activeBrush: 0, lessons, month: minDate.slice(0, 7) };
}

export function setName(s: EditorState, name: string): EditorState {
  return { ...s, name };
}

export function selectBrush(s: EditorState, index: number): EditorState {
  return index >= 0 && index < s.brushes.length ? { ...s, activeBrush: index } : s;
}

/** 非法/重复时间段不新增；重复的只切换选中。 */
export function addBrush(s: EditorState, brush: TimeBrush): EditorState {
  if (!isValidBrush(brush)) return s;
  const existing = s.brushes.findIndex((b) => b.startTime === brush.startTime && b.endTime === brush.endTime);
  if (existing >= 0) return { ...s, activeBrush: existing };
  return { ...s, brushes: [...s.brushes, brush], activeBrush: s.brushes.length };
}

/** 用当前刷子点一天：无该 startTime → 加节；同刷同段 → 取消；同 start 异 end → 替换。 */
export function toggleDay(s: EditorState, date: string): EditorState {
  const brush = s.brushes[s.activeBrush];
  if (!brush) return s;
  const at = s.lessons.find((l) => l.date === date && l.startTime === brush.startTime);
  if (at && at.endTime === brush.endTime) return removeLesson(s, date, brush.startTime);
  if (at) {
    return {
      ...s,
      lessons: s.lessons.map((l) => (l === at ? { ...l, endTime: brush.endTime } : l)),
    };
  }
  return { ...s, lessons: [...s.lessons, { date, startTime: brush.startTime, endTime: brush.endTime }] };
}

export function removeLesson(s: EditorState, date: string, startTime: string): EditorState {
  return { ...s, lessons: s.lessons.filter((l) => !(l.date === date && l.startTime === startTime)) };
}

export function prevMonth(s: EditorState): EditorState {
  return { ...s, month: shiftMonth(s.month, -1) };
}

export function nextMonth(s: EditorState): EditorState {
  return { ...s, month: shiftMonth(s.month, 1) };
}

// ---- 派生 ------------------------------------------------------------------

export function lessonsOn(s: EditorState, date: string): EditorLesson[] {
  return s.lessons.filter((l) => l.date === date).sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export function sortedLessons(s: EditorState): EditorLesson[] {
  return s.lessons.slice().sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
}

/** 节次对应哪把刷子（用于上色）；编辑旧周期时可能匹配不到 → -1。 */
export function brushIndexOf(s: EditorState, lesson: Pick<EditorLesson, 'startTime' | 'endTime'>): number {
  return s.brushes.findIndex((b) => b.startTime === lesson.startTime && b.endTime === lesson.endTime);
}

export function canSave(s: EditorState): boolean {
  return s.name.trim().length > 0 && s.lessons.length > 0;
}

export function toPayload(s: EditorState): { name: string; lessons: EditorLesson[] } {
  return { name: s.name.trim(), lessons: sortedLessons(s) };
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${y} 年 ${m} 月`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface GridCell {
  date: string; // YYYY-MM-DD
  day: number;
  inMonth: boolean;
}

/** 6×7 月历格（周一开头），含前后月补位。 */
export function monthGrid(month: string): GridCell[] {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7; // Mon=0
  const cells: GridCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(Date.UTC(y, m - 1, 1 - offset + i));
    const iso = d.toISOString().slice(0, 10);
    cells.push({ date: iso, day: d.getUTCDate(), inMonth: d.getUTCMonth() === m - 1 });
  }
  return cells;
}

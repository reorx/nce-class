import type { AttendanceSession, AttendanceStatus, ClassAttendance, StudentStatus } from './api';

/** One grid cell: status null = no membership row that day (未入班/已停课). */
export interface CellState {
  status: AttendanceStatus | null;
  madeUp: boolean;
}

/** What the lookup map needs per record — the page keeps live edits in this shape. */
export interface CellRecord {
  status: AttendanceStatus;
  madeUp: boolean;
}

export interface RowStats {
  sched: number; // sessions the student was on the roster for
  pres: number; // present + made-up
  absent: number;
  leave: number;
  madeUp: number;
  rate: number | null; // % rounded; null when sched=0
  full: boolean;
}

export const recordKey = (sessionId: string, studentId: string) => `${sessionId}:${studentId}`;

export function rowCells(studentId: string, sessions: AttendanceSession[], map: Map<string, CellRecord>): CellState[] {
  return sessions.map((s) => {
    const r = map.get(recordKey(s.id, studentId));
    return r ? { status: r.status, madeUp: r.madeUp } : { status: null, madeUp: false };
  });
}

export function rowStats(cells: CellState[]): RowStats {
  let sched = 0,
    pres = 0,
    absent = 0,
    leave = 0,
    madeUp = 0;
  for (const c of cells) {
    if (c.status == null) continue;
    sched++;
    if (c.status === 'present' || c.madeUp) pres++;
    if (c.status === 'absent') absent++;
    if (c.status === 'leave') leave++;
    if (c.madeUp) madeUp++;
  }
  const rate = sched ? Math.round((pres / sched) * 100) : null;
  return { sched, pres, absent, leave, madeUp, rate, full: sched > 0 && pres === sched };
}

export function rateColor(rate: number | null): string {
  if (rate == null) return '#c2cabb';
  return rate >= 90 ? '#2fb457' : rate >= 75 ? '#e0912a' : '#e0454a';
}

/** 停课 from the student status; 插班 derived from leading off-cells before the first record. */
export function rowTag(status: StudentStatus, cells: CellState[]): '停课' | '插班' | null {
  if (status === 'suspended') return '停课';
  const first = cells.findIndex((c) => c.status != null);
  return first > 0 ? '插班' : null;
}

export function classAttendanceStats(rows: RowStats[]): { avg: number; full: number } {
  const rated = rows.filter((r) => r.rate != null);
  const avg = rated.length ? Math.round(rated.reduce((a, r) => a + (r.rate as number), 0) / rated.length) : 0;
  return { avg, full: rows.filter((r) => r.full).length };
}

export function dateParts(date: string): { mm: number; dd: number } {
  return { mm: Number(date.slice(5, 7)), dd: Number(date.slice(8, 10)) };
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayCN(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00`).getDay()];
}

const CSV_MARK: Record<AttendanceStatus, string> = { present: '出勤', absent: '缺勤', leave: '请假' };

export function buildAttendanceCsv(data: ClassAttendance): string {
  const map = new Map(data.records.map((r) => [recordKey(r.sessionId, r.studentId), r]));
  const head = ['学生', ...data.sessions.map((s) => `${dateParts(s.date).mm}/${dateParts(s.date).dd}`), '出勤率'];
  const rows = data.students.map((st) => {
    const cells = rowCells(st.id, data.sessions, map);
    const stats = rowStats(cells);
    const marks = cells.map((c) => (c.status == null ? '—' : CSV_MARK[c.status] + (c.madeUp ? '（已补课）' : '')));
    return [st.name, ...marks, stats.rate == null ? '—' : `${stats.rate}%`];
  });
  return [head, ...rows].map((r) => r.join(',')).join('\n');
}

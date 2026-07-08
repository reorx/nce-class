// ---------------------------------------------------------------------------
// Classroom session model + pure derivation logic.
//
// Scoring is an event stream (§5 of the M1 PRD): a student's per-session score
// and a group's per-session score are *derived* from ±1 ScoreEvents, never
// stored. This module owns that derivation so the UI stays a thin renderer and
// the rules can be unit-tested in isolation.
//
// The demo scenario below reproduces the "第3课 · Lesson 3" state used across
// the classroom mockups (nce-class-v1-design/课堂主界面.dc.html). Until the
// session engine (PRD stage 3) is wired to the API, the classroom boots from
// this in-memory snapshot.
// ---------------------------------------------------------------------------

export type Recitation = '已背完' | '背完部分' | '没背' | null;
// 作业没有「未批改」态：默认人人「没交」，交了改「完成」，交了但要补做改「需补」。
// （server 读侧本就把「缺记录」fallback 成 没交 —— 见 profile / wx recap mine。）
export type Homework = '没交' | '完成' | '需补';

export interface SStudent {
  id: string; // real student id (needed to POST the session to the backend)
  g: string; // current group id (mutable via 调组)
  name: string;
  r: Recitation;
  h: Homework;
  // 奖章 tag names awarded this session. Optional (persisted-shape compat):
  // sessions saved by pre-tag builds lack it — every reader uses `tags ?? []`.
  tags?: string[];
}

export interface SGroup {
  id: string;
  name: string;
  emoji: string;
}

export interface SEvent {
  id: number; // local monotonic sequence (keys / undo only)
  tt: 'student' | 'group';
  tid: string; // student id or group id, matching tt
  g: string; // the group the target belonged to when the event fired
  d: 1 | -1;
  createdAt: string; // 'YYYY-MM-DD HH:mm:ss' — carried into the commit payload
  // 背书自动加分的来源标记：「已背完」绑定唯一 1 分，离开该状态时按此标记收回。
  // Optional (persisted-shape compat)，仅本地，不进 commit payload。
  src?: 'recite';
}

export interface SessionState {
  students: SStudent[];
  groups: SGroup[];
  events: SEvent[];
  nid: number; // next event id
}

// ---- colour tokens --------------------------------------------------------

/** Per-group header / avatar-ring colours, keyed by group order index. */
export const GROUP_COLORS = [
  { headBg: '#fff2d6', headFg: '#b07d16', ring: '#f5a623' }, // 🦁 amber
  { headBg: '#ffe7df', headFg: '#cf5236', ring: '#fb7a5c' }, // 🐯 coral
  { headBg: '#e2f0ff', headFg: '#2a75be', ring: '#6fb1fc' }, // 🐻 blue
  { headBg: '#e6f7ec', headFg: '#1e9e4a', ring: '#5fce93' }, // 🌿 green
  { headBg: '#f0eafb', headFg: '#7a52c0', ring: '#b491e8' }, // 🍇 violet
];

export const GRAY = { dot: '#c9cfd6', soft: '#eef1f4', fg: '#98a2b0' };

export const RECITE_MAP: Record<string, { dot: string; soft: string; fg: string }> = {
  已背完: { dot: '#34c759', soft: '#e4f8ea', fg: '#1e9e4a' },
  背完部分: { dot: '#ffb020', soft: '#fff3d6', fg: '#c08600' },
  没背: { dot: '#c9cfd6', soft: '#eef1f4', fg: '#98a2b0' },
};

export const HOMEWORK_MAP: Record<string, { dot: string; soft: string; fg: string }> = {
  完成: { dot: '#34c759', soft: '#e4f8ea', fg: '#1e9e4a' },
  需补: { dot: '#ffb020', soft: '#fff3d6', fg: '#c08600' },
  没交: { dot: '#c9cfd6', soft: '#eef1f4', fg: '#98a2b0' },
};

// ---- pure derivations -----------------------------------------------------

/** A student's per-session personal score = Σ delta of their own events. */
export function sScore(events: SEvent[], id: string): number {
  return events.filter((e) => e.tt === 'student' && e.tid === id).reduce((a, e) => a + e.d, 0);
}

/**
 * A group's per-session score (nested): group-level events + every student
 * event tagged with this group at the time it fired. Re-grouping later does not
 * rewrite history because each event carries its own group id.
 */
export function gScore(events: SEvent[], gid: string): number {
  return events
    .filter((e) => (e.tt === 'group' && e.tid === gid) || (e.tt === 'student' && e.g === gid))
    .reduce((a, e) => a + e.d, 0);
}

/**
 * 小组分明细（浮窗展示用）：把 gScore 的同一批事件拆成三笔——
 * 组内学生个人加分累计 / 小组独立加分累计 / 扣分累计（学生+小组的负分，取正数）。
 * 恒有 total = studentPlus + groupPlus − minus，且 total === gScore。
 */
export interface GroupScoreBreakdown {
  total: number;
  studentPlus: number;
  groupPlus: number;
  minus: number;
}

export function gScoreBreakdown(events: SEvent[], gid: string): GroupScoreBreakdown {
  const b = { total: 0, studentPlus: 0, groupPlus: 0, minus: 0 };
  for (const e of events) {
    const own = e.tt === 'group' && e.tid === gid;
    if (!own && !(e.tt === 'student' && e.g === gid)) continue;
    b.total += e.d;
    if (e.d < 0) b.minus -= e.d;
    else if (own) b.groupPlus += e.d;
    else b.studentPlus += e.d;
  }
  return b;
}

/** Board view ordering: members by personal score desc; ties keep roster order. */
export function byScoreDesc(students: SStudent[], events: SEvent[]): SStudent[] {
  return students
    .map((s, i) => ({ s, i, sc: sScore(events, s.id) }))
    .sort((a, b) => b.sc - a.sc || a.i - b.i)
    .map((x) => x.s);
}

/** Recap "亮眼" list: personal net score ≥ 2 this session (§6, default threshold). */
export function stars(students: SStudent[], events: SEvent[]): SStudent[] {
  return students.filter((s) => sScore(events, s.id) >= 2);
}

/** Recap "被提醒" list: any negative personal event this session (§6). */
export function warned(students: SStudent[], events: SEvent[]): SStudent[] {
  return students.filter((s) => events.some((e) => e.tt === 'student' && e.tid === s.id && e.d < 0));
}

/** Recap 奖章 list: students with ≥1 tag this session, in roster order. */
export function studentTags(students: SStudent[]): { id: string; name: string; tags: string[] }[] {
  return students.filter((s) => (s.tags ?? []).length > 0).map((s) => ({ id: s.id, name: s.name, tags: s.tags! }));
}

// ---- demo scenario (Lesson 3) --------------------------------------------
// Fixture only: pins the §5/§6 scoring rules in session.test.ts. Since decision
// 13 removed the classroom's Lesson-3 page entry, this is no longer a runtime
// boot path — the classroom always boots from a local ClassroomSession.

const AT = '2026-05-29 19:00:00'; // fixed timestamp; scoring derivations ignore it

export function initialSession(): SessionState {
  const ev = (id: number, tt: 'student' | 'group', tid: string, g: string, d: 1 | -1): SEvent => ({
    id,
    tt,
    tid,
    g,
    d,
    createdAt: AT,
  });
  return {
    students: [
      { id: '1', g: 'g1', name: '小明', r: '已背完', h: '完成' },
      { id: '2', g: 'g1', name: '小红', r: '背完部分', h: '完成' },
      { id: '3', g: 'g1', name: '小刚', r: null, h: '没交' },
      { id: '4', g: 'g1', name: '乐乐', r: '没背', h: '没交' },
      { id: '5', g: 'g2', name: '丽丽', r: '已背完', h: '完成' },
      { id: '6', g: 'g2', name: '大壮', r: null, h: '完成' },
      { id: '7', g: 'g2', name: '欣欣', r: '已背完', h: '完成' },
      { id: '8', g: 'g2', name: '明明', r: '背完部分', h: '没交' },
      { id: '9', g: 'g3', name: '军军', r: '已背完', h: '完成' },
      { id: '10', g: 'g3', name: '悦悦', r: null, h: '没交' },
      { id: '11', g: 'g3', name: '婷婷', r: '没背', h: '没交' },
      { id: '12', g: 'g3', name: '浩浩', r: '已背完', h: '完成' },
    ],
    groups: [
      { id: 'g1', name: '第1组', emoji: '🦁' },
      { id: 'g2', name: '第2组', emoji: '🐯' },
      { id: 'g3', name: '第3组', emoji: '🐻' },
    ],
    events: [
      ev(1, 'student', '1', 'g1', 1),
      ev(2, 'student', '1', 'g1', 1),
      ev(3, 'student', '2', 'g1', 1),
      ev(4, 'group', 'g1', 'g1', 1),
      ev(5, 'student', '5', 'g2', 1),
      ev(6, 'student', '7', 'g2', 1),
      ev(7, 'student', '7', 'g2', 1),
      ev(8, 'group', 'g2', 'g2', 1),
      ev(9, 'student', '9', 'g3', 1),
      ev(10, 'student', '9', 'g3', 1),
      ev(11, 'student', '9', 'g3', 1),
      ev(12, 'student', '11', 'g3', -1),
      ev(13, 'group', 'g3', 'g3', 1),
    ],
    nid: 100,
  };
}

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
export type Homework = '完成' | '没交' | null;

export interface SStudent {
  id: number;
  g: string; // current group id (mutable via 调组)
  name: string;
  r: Recitation;
  h: Homework;
}

export interface SGroup {
  id: string;
  name: string;
  emoji: string;
}

export interface SEvent {
  id: number;
  tt: 'student' | 'group';
  tid: number | string;
  g: string; // the group the target belonged to when the event fired
  d: 1 | -1;
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
  没交: { dot: '#c9cfd6', soft: '#eef1f4', fg: '#98a2b0' },
};

// ---- pure derivations -----------------------------------------------------

/** A student's per-session personal score = Σ delta of their own events. */
export function sScore(events: SEvent[], id: number): number {
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

/** Recap "亮眼" list: personal net score ≥ 2 this session (§6, default threshold). */
export function stars(students: SStudent[], events: SEvent[]): SStudent[] {
  return students.filter((s) => sScore(events, s.id) >= 2);
}

/** Recap "被提醒" list: any negative personal event this session (§6). */
export function warned(students: SStudent[], events: SEvent[]): SStudent[] {
  return students.filter((s) => events.some((e) => e.tt === 'student' && e.tid === s.id && e.d < 0));
}

// ---- demo scenario (Lesson 3) --------------------------------------------

export function initialSession(): SessionState {
  return {
    students: [
      { id: 1, g: 'g1', name: '小明', r: '已背完', h: '完成' },
      { id: 2, g: 'g1', name: '小红', r: '背完部分', h: '完成' },
      { id: 3, g: 'g1', name: '小刚', r: null, h: null },
      { id: 4, g: 'g1', name: '乐乐', r: '没背', h: '没交' },
      { id: 5, g: 'g2', name: '丽丽', r: '已背完', h: '完成' },
      { id: 6, g: 'g2', name: '大壮', r: null, h: '完成' },
      { id: 7, g: 'g2', name: '欣欣', r: '已背完', h: '完成' },
      { id: 8, g: 'g2', name: '明明', r: '背完部分', h: null },
      { id: 9, g: 'g3', name: '军军', r: '已背完', h: '完成' },
      { id: 10, g: 'g3', name: '悦悦', r: null, h: null },
      { id: 11, g: 'g3', name: '婷婷', r: '没背', h: '没交' },
      { id: 12, g: 'g3', name: '浩浩', r: '已背完', h: '完成' },
    ],
    groups: [
      { id: 'g1', name: '第1组', emoji: '🦁' },
      { id: 'g2', name: '第2组', emoji: '🐯' },
      { id: 'g3', name: '第3组', emoji: '🐻' },
    ],
    events: [
      { id: 1, tt: 'student', tid: 1, g: 'g1', d: 1 },
      { id: 2, tt: 'student', tid: 1, g: 'g1', d: 1 },
      { id: 3, tt: 'student', tid: 2, g: 'g1', d: 1 },
      { id: 4, tt: 'group', tid: 'g1', g: 'g1', d: 1 },
      { id: 5, tt: 'student', tid: 5, g: 'g2', d: 1 },
      { id: 6, tt: 'student', tid: 7, g: 'g2', d: 1 },
      { id: 7, tt: 'student', tid: 7, g: 'g2', d: 1 },
      { id: 8, tt: 'group', tid: 'g2', g: 'g2', d: 1 },
      { id: 9, tt: 'student', tid: 9, g: 'g3', d: 1 },
      { id: 10, tt: 'student', tid: 9, g: 'g3', d: 1 },
      { id: 11, tt: 'student', tid: 9, g: 'g3', d: 1 },
      { id: 12, tt: 'student', tid: 11, g: 'g3', d: -1 },
      { id: 13, tt: 'group', tid: 'g3', g: 'g3', d: 1 },
    ],
    nid: 100,
  };
}

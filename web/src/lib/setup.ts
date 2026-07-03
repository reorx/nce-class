// ---------------------------------------------------------------------------
// 课前配置 (pre-class setup) model + pure logic (§7.2 of the M1 PRD).
//
// The setup page starts from a class's *default grouping* (ClassGroup +
// memberships) and lets the teacher micro-adjust before starting the session:
// drag students between groups, drop the absent/ungrouped into a staging zone,
// add groups. Students left in staging are excluded from scoring this session.
//
// All state is a thin, pure, testable shape so the page stays a renderer. The
// grouping the teacher confirms becomes the classroom's fresh session snapshot
// (buildSessionConfig) — and, once persistence lands, the班级 default grouping.
// ---------------------------------------------------------------------------

import type { ClassDetail } from './api';
import { GROUP_COLORS } from './session';

/** Fallback per-group emoji cycle when a group has none (matches the mockups). */
export const EMOJIS = ['🦁', '🐯', '🐻', '🐬', '🦊', '🐨', '🐧', '🐰'];
export const MEDALS = ['🥇', '🥈', '🥉'];

export interface SetupGroup {
  id: string;
  name: string;
  emoji: string;
  ci: number; // colour index into GROUP_COLORS
}

export interface SetupStudent {
  id: string;
  name: string;
  hasPhoto: boolean;
  origin: string | null; // the student's group in the class's *default* grouping (§7.2 writeback)
}

export interface SetupState {
  groups: SetupGroup[];
  students: SetupStudent[]; // full roster, stable order
  assign: Record<string, string>; // studentId -> groupId (playing)
  absent: Record<string, true>; // studentId -> in the staging zone (not scored)
  gidSeq: number; // next locally-created group id
}

type Detail = Pick<ClassDetail, 'groups' | 'students'>;

/** Build the initial setup state from a class's default grouping. Suspended /
 *  archived students never enter a session — not even as absent. */
export function buildSetup(detail: Detail): SetupState {
  const roster = detail.students.filter((s) => s.status === 'active');
  const groups: SetupGroup[] = detail.groups.map((g, i) => ({
    id: g.id,
    name: g.name,
    emoji: g.emoji ?? EMOJIS[i % EMOJIS.length],
    ci: g.orderIndex ?? i,
  }));
  const valid = new Set(groups.map((g) => g.id));
  const assign: Record<string, string> = {};
  const absent: Record<string, true> = {};
  for (const s of roster) {
    if (s.groupId && valid.has(s.groupId)) assign[s.id] = s.groupId;
    else absent[s.id] = true; // ungrouped → staging zone
  }
  const students: SetupStudent[] = roster.map((s) => ({
    id: s.id,
    name: s.name,
    hasPhoto: s.hasPhoto,
    origin: s.groupId && valid.has(s.groupId) ? s.groupId : null,
  }));
  return { groups, students, assign, absent, gidSeq: 1 };
}

/** Move a student to a group (its id) or to the staging zone ('absent'). */
export function moveStudent(state: SetupState, sid: string, zone: string): SetupState {
  const assign = { ...state.assign };
  const absent = { ...state.absent };
  if (zone === 'absent') {
    delete assign[sid];
    absent[sid] = true;
  } else {
    assign[sid] = zone;
    delete absent[sid];
  }
  return { ...state, assign, absent };
}

/** Append a new empty group with the next emoji/colour in the cycle. */
export function addGroup(state: SetupState): SetupState {
  const idx = state.groups.length;
  const g: SetupGroup = {
    id: `new-${state.gidSeq}`,
    name: `第${idx + 1}组`,
    emoji: EMOJIS[idx % EMOJIS.length],
    ci: idx % GROUP_COLORS.length,
  };
  return { ...state, groups: [...state.groups, g], gidSeq: state.gidSeq + 1 };
}

/** Members of a group, preserving roster order. */
export function membersOf(state: SetupState, gid: string): SetupStudent[] {
  return state.students.filter((s) => state.assign[s.id] === gid);
}

/** Students parked in the staging zone (not scored this session). */
export function stagingMembers(state: SetupState): SetupStudent[] {
  return state.students.filter((s) => state.absent[s.id]);
}

export function sums(state: SetupState): { groups: number; playing: number; absent: number } {
  return {
    groups: state.groups.length,
    playing: Object.keys(state.assign).length,
    absent: Object.keys(state.absent).length,
  };
}

/** "112" -> "1 小时 52 分" · whole hours drop the minutes · under 1h shows 分钟. */
export function fmtDurationCN(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h} 小时 ${m} 分`;
  if (h) return `${h} 小时`;
  return `${m} 分钟`;
}

// ---- classroom handoff ----------------------------------------------------

export interface SessionInfo {
  lessonNumber: string;
  lessonTitle: string;
  durationMin: number;
  className?: string;
}

/** A pre-class-absent student, carried so the classroom can register them
 *  (membership + attendance) and keep their default group for §7.2 writeback. */
export interface AbsentStudent {
  id: string;
  name: string;
  originalGroupId: string | null; // default group at open time (null → stays ungrouped)
}

export interface SessionConfig extends SessionInfo {
  groups: { id: string; name: string; emoji: string; ci: number }[];
  students: { id: string; name: string; g: string }[]; // playing (present + grouped)
  absent: AbsentStudent[]; // staging-zone students: registered but not scored this session
}

/**
 * Freeze the confirmed grouping into a snapshot the classroom boots from.
 * Playing students carry their (possibly re-dragged) group; staged students are
 * emitted as `absent` keeping their *default* group (decision 6), so the class
 * default grouping isn't silently wiped when someone is absent.
 */
export function buildSessionConfig(state: SetupState, info: SessionInfo): SessionConfig {
  const valid = new Set(state.groups.map((g) => g.id));
  const students = state.students
    .filter((s) => state.assign[s.id])
    .map((s) => ({ id: s.id, name: s.name, g: state.assign[s.id] }));
  const absent: AbsentStudent[] = state.students
    .filter((s) => state.absent[s.id])
    .map((s) => ({ id: s.id, name: s.name, originalGroupId: s.origin && valid.has(s.origin) ? s.origin : null }));
  const groups = state.groups.map((g) => ({ id: g.id, name: g.name, emoji: g.emoji, ci: g.ci }));
  return { ...info, groups, students, absent };
}

/** Build a session config straight from a class's real default grouping — the
 *  URL-parameter boot shortcut (decision 13). Ungrouped students → absent. */
export function configFromDetail(detail: Detail, info: SessionInfo): SessionConfig {
  return buildSessionConfig(buildSetup(detail), info);
}

/** Header label for a session: "第4课 · A private conversation" (parts optional). */
export function lessonLabel(cfg: Pick<SessionConfig, 'lessonNumber' | 'lessonTitle'>): string {
  const parts = [cfg.lessonNumber && `第${cfg.lessonNumber}课`, cfg.lessonTitle].filter(Boolean);
  return parts.join(' · ') || '本节课';
}

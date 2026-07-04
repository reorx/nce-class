// ---------------------------------------------------------------------------
// 课堂日志派生（view-model only，仅本地）.
//
// The log view merges two sources into one timeline:
//   - score events (session.events, the authoritative ledger) — undoable: the
//     undoEvent action DELETES the event, and because personal AND group score
//     both derive from that single event, the undo is atomic by construction;
//   - status changes (session.log: 背书/作业/出勤) — record-only.
// Both draw ids from the session's shared nid counter, so sorting by id gives
// a stable total order even for entries within the same second.
// ---------------------------------------------------------------------------

import type { ClassroomSession } from './classroomStore';

export interface LogLine {
  id: number;
  at: string; // 'YYYY-MM-DD HH:mm:ss'
  icon: string;
  who: string; // 主体：学生名或组名
  action: string; // '+1' / '−1' / '背书 → 已背完' / '标记未到' …
  detail?: string; // 个人加减分的组同步说明
  eventId?: number; // present → an undoable score event
  tone: 'plus' | 'minus' | 'neutral';
}

/** Merge score events + status log into display lines, newest first. */
export function buildLogLines(s: Pick<ClassroomSession, 'students' | 'groups' | 'events' | 'log'>): LogLine[] {
  const studentName = (sid: string) => s.students.find((x) => x.id === sid)?.name ?? '未知学生';
  const groupName = (gid: string) => s.groups.find((g) => g.id === gid)?.name ?? '已删除小组';

  const lines: LogLine[] = s.events.map((e) => {
    const sign = e.d > 0 ? '+1' : '−1';
    const tone = e.d > 0 ? ('plus' as const) : ('minus' as const);
    return e.tt === 'student'
      ? {
          id: e.id,
          at: e.createdAt,
          icon: '⭐',
          who: studentName(e.tid),
          action: sign,
          // 未分组学生的事件不计任何组分 → 没有同步说明
          detail: e.g ? `${groupName(e.g)} 同步 ${sign}` : undefined,
          eventId: e.id,
          tone,
        }
      : { id: e.id, at: e.createdAt, icon: '⭐', who: groupName(e.tid), action: sign, eventId: e.id, tone };
  });

  for (const l of s.log ?? []) {
    const who = studentName(l.sid);
    if (l.kind === 'attendance') {
      lines.push({
        id: l.id,
        at: l.at,
        icon: '📋',
        who,
        action: l.to === 'absent' ? '标记未到' : '恢复到勤',
        tone: 'neutral',
      });
    } else {
      lines.push({
        id: l.id,
        at: l.at,
        icon: l.kind === 'recite' ? '📖' : '📝',
        who,
        action: `${l.kind === 'recite' ? '背书' : '作业'} → ${l.to ?? '未检查'}`,
        tone: 'neutral',
      });
    }
  }

  return lines.sort((a, b) => b.id - a.id);
}

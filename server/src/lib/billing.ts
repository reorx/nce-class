// 计费派生（纯函数）：收款批次快照与「重新计算」共用同一实现，口径见
// kb/plans/2026-07-20-nce-class-billing-schedule.md。
// ⚠️ `today` 是显式参数（YYYY-MM-DD）：生产路径传真实当天，测试传固定值。
// 不要用 REFERENCE_TODAY——那只服务展示层相对日期文案，账务按它切分会错账。

export interface LessonPlan {
  date: string; // YYYY-MM-DD
}

export interface EndedSession {
  id: string;
  date: string; // YYYY-MM-DD
}

export interface MembershipRecord {
  sessionId: string;
  studentId: string;
  attendance: string; // present | absent | leave
  madeUp: number; // 0 | 1
}

export interface StudentCounts {
  attendedCount: number; // 已上到堂（present || madeUp）
  plannedCount: number; // 未上计划节数（假定未来全勤）
  billableCount: number; // = attended + planned
}

/** 周期起止 = lessons 日期的 min/max；无节次 → null。 */
export function scheduleRange(lessons: LessonPlan[]): { minDate: string; maxDate: string } | null {
  if (!lessons.length) return null;
  let minDate = lessons[0].date;
  let maxDate = lessons[0].date;
  for (const l of lessons) {
    if (l.date < minDate) minDate = l.date;
    if (l.date > maxDate) maxDate = l.date;
  }
  return { minDate, maxDate };
}

/**
 * 单个学生的计费节数（过去按事实、未来按计划）：
 * - attended：周期范围内该班全部实际 session（含排班外临时加课），逐节按快照行
 *   present || madeUp=1 计 1；无快照行（中途入班前的课）计 0。
 * - planned：date > today 的节次，加 date == today 且该班当天尚无 session 的节次
 *   （当天已上过课则当天全部排班不再计，边界接受、由重算兜底）；
 *   停课/归档学生 planned 强制 0，只结已上部分。
 * - lessonCountOverride（课程次数，用户输入为准）：设了则总量以它为纲——
 *   planned = max(0, override − 周期内已上节数)，全勤学生恰好计费 override 节，
 *   缺勤照常从 attended 里扣；排班节次日期只用来定周期范围。
 */
export function computeStudentCounts(p: {
  studentId: string;
  status: string; // active | suspended | archived
  lessons: LessonPlan[];
  sessions: EndedSession[];
  memberships: MembershipRecord[];
  today: string; // YYYY-MM-DD
  lessonCountOverride?: number | null;
}): StudentCounts {
  const range = scheduleRange(p.lessons);
  if (!range) return { attendedCount: 0, plannedCount: 0, billableCount: 0 };

  const inRange = p.sessions.filter((s) => s.date >= range.minDate && s.date <= range.maxDate);
  const attendedSessionIds = new Set(
    p.memberships
      .filter((m) => m.studentId === p.studentId && (m.attendance === 'present' || m.madeUp === 1))
      .map((m) => m.sessionId),
  );
  const attendedCount = inRange.filter((s) => attendedSessionIds.has(s.id)).length;

  let plannedCount = 0;
  if (p.status === 'active') {
    if (p.lessonCountOverride != null) {
      plannedCount = Math.max(0, p.lessonCountOverride - inRange.length);
    } else {
      const sessionDates = new Set(p.sessions.map((s) => s.date));
      plannedCount = p.lessons.filter(
        (l) => l.date > p.today || (l.date === p.today && !sessionDates.has(p.today)),
      ).length;
    }
  }

  return { attendedCount, plannedCount, billableCount: attendedCount + plannedCount };
}

/** 应收 = 单价 × 计费节数 + 附加费；billable=0 时整体为 0（附加费也不收）。 */
export function computeAmountCents(p: { unitPriceCents: number; billableCount: number; addonCents: number }): number {
  return p.billableCount === 0 ? 0 : p.unitPriceCents * p.billableCount + p.addonCents;
}

/**
 * 建单学生范围（保持传入顺序）：active 全量（billable=0 也建，未来要上课）
 * ∪ 周期内 attended>0 的非 active 学生。
 */
export function buildBatchSnapshot(p: {
  students: { id: string; status: string }[];
  lessons: LessonPlan[];
  sessions: EndedSession[];
  memberships: MembershipRecord[];
  today: string;
  lessonCountOverride?: number | null;
}): ({ studentId: string } & StudentCounts)[] {
  const rows: ({ studentId: string } & StudentCounts)[] = [];
  for (const s of p.students) {
    const counts = computeStudentCounts({
      studentId: s.id,
      status: s.status,
      lessons: p.lessons,
      sessions: p.sessions,
      memberships: p.memberships,
      today: p.today,
      lessonCountOverride: p.lessonCountOverride,
    });
    if (s.status === 'active' || counts.attendedCount > 0) rows.push({ studentId: s.id, ...counts });
  }
  return rows;
}

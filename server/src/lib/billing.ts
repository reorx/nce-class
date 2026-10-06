// 计费派生（纯函数）：收款批次快照与「重新计算」共用同一实现，口径见
// kb/docs/business-rules.md「排班与收费」。
// 应收 = 单价 × 本批次课程次数 + 附加费，全班一致、不看出勤；出勤（已上到堂）
// 只记下来供展示，个别学生（中途入班、停课等）由老师直接改最终收款金额。
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

export interface BatchCounts {
  lessonCount: number; // 计费节数 = 课程次数（手动填写）?? 排班节数
  heldCount: number; // 周期范围内实际已上节数（含排班外临时加课）
  futureCount: number; // 未上计划节数
}

export interface StudentCounts {
  attendedCount: number; // 已上到堂（present || madeUp），仅展示
  plannedCount: number; // 未上计划节数（= 批次 futureCount）
  billableCount: number; // 计费节数（= 批次 lessonCount）
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

function sessionsInRange(lessons: LessonPlan[], sessions: EndedSession[]): EndedSession[] {
  const range = scheduleRange(lessons);
  if (!range) return [];
  return sessions.filter((s) => s.date >= range.minDate && s.date <= range.maxDate);
}

/**
 * 批次级节数，全班一致：
 * - lessonCount：设了课程次数（lessonCountOverride）以它为准，否则 = 排班节数。
 * - heldCount：周期范围内该班全部实际 session（含排班外临时加课）。
 * - futureCount：设了课程次数 = max(0, 次数 − heldCount)；否则 = date > today 的
 *   排班节次，加 date == today 且该班当天尚无 session 的节次（当天已上过课则当天
 *   全部排班不再计，边界接受）。
 */
export function computeBatchCounts(p: {
  lessons: LessonPlan[];
  sessions: EndedSession[];
  today: string; // YYYY-MM-DD
  lessonCountOverride?: number | null;
}): BatchCounts {
  if (!p.lessons.length) return { lessonCount: 0, heldCount: 0, futureCount: 0 };
  const heldCount = sessionsInRange(p.lessons, p.sessions).length;
  if (p.lessonCountOverride != null) {
    return {
      lessonCount: p.lessonCountOverride,
      heldCount,
      futureCount: Math.max(0, p.lessonCountOverride - heldCount),
    };
  }
  const sessionDates = new Set(p.sessions.map((s) => s.date));
  const futureCount = p.lessons.filter(
    (l) => l.date > p.today || (l.date === p.today && !sessionDates.has(p.today)),
  ).length;
  return { lessonCount: p.lessons.length, heldCount, futureCount };
}

/**
 * 周期内该生已上到堂节数：范围内实际 session 逐节按快照行 present || madeUp=1
 * 计 1；无快照行（中途入班前的课）计 0。只做展示，不参与应收。
 */
export function computeAttendedCount(p: {
  studentId: string;
  lessons: LessonPlan[];
  sessions: EndedSession[];
  memberships: MembershipRecord[];
}): number {
  const attendedSessionIds = new Set(
    p.memberships
      .filter((m) => m.studentId === p.studentId && (m.attendance === 'present' || m.madeUp === 1))
      .map((m) => m.sessionId),
  );
  return sessionsInRange(p.lessons, p.sessions).filter((s) => attendedSessionIds.has(s.id)).length;
}

/** 收款单快照的三个节数：到堂按该生出勤，未上与计费节数取批次值（人人相同）。 */
export function computeStudentCounts(p: {
  studentId: string;
  lessons: LessonPlan[];
  sessions: EndedSession[];
  memberships: MembershipRecord[];
  today: string; // YYYY-MM-DD
  lessonCountOverride?: number | null;
}): StudentCounts {
  const batch = computeBatchCounts(p);
  return {
    attendedCount: computeAttendedCount(p),
    plannedCount: batch.futureCount,
    billableCount: batch.lessonCount,
  };
}

/** 应收 = 单价 × 计费节数 + 附加费。 */
export function computeAmountCents(p: { unitPriceCents: number; billableCount: number; addonCents: number }): number {
  return p.unitPriceCents * p.billableCount + p.addonCents;
}

/**
 * 建单学生范围（保持传入顺序）：active 全量 ∪ 周期内 attended>0 的非 active 学生。
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
    const counts = computeStudentCounts({ ...p, studentId: s.id });
    if (s.status === 'active' || counts.attendedCount > 0) rows.push({ studentId: s.id, ...counts });
  }
  return rows;
}

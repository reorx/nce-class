import { describe, expect, it } from 'vitest';
import { byScoreDesc, gScore, gScoreBreakdown, initialSession, sScore, stars, warned, type SStudent } from './session';

/** Move one student into another group (or '' = ungrouped), as the 调组 view does. */
const moveTo = (students: SStudent[], id: string, g: string) => students.map((s) => (s.id === id ? { ...s, g } : s));

// Behaviour of the event-stream scoring rules (§5/§6 of the M1 PRD), pinned to
// the Lesson-3 demo scenario that the classroom mockups render.
describe('classroom scoring (Lesson 3 scenario)', () => {
  const { students, events } = initialSession();

  it('derives a student personal score from their own ±1 events', () => {
    expect(sScore(events, '1')).toBe(2); // 小明 +1 +1
    expect(sScore(events, '2')).toBe(1); // 小红 +1
    expect(sScore(events, '3')).toBe(0); // 小刚 (no events)
    expect(sScore(events, '11')).toBe(-1); // 婷婷 −1
  });

  it("derives a group score = current members' personal scores + the group's own events", () => {
    expect(gScore(students, events, 'g1')).toBe(4); // 小明+2, 小红+1, 组+1
    expect(gScore(students, events, 'g2')).toBe(4); // 丽丽+1, 欣欣+2, 组+1
    expect(gScore(students, events, 'g3')).toBe(3); // 军军+3, 婷婷−1, 组+1
  });

  it('does not fold group-level events into any personal score', () => {
    // g1 has a group +1 event, yet no student in g1 gains it individually.
    const g1Ids = students.filter((s) => s.g === 'g1').map((s) => s.id);
    const personalSum = g1Ids.reduce((a, id) => a + sScore(events, id), 0);
    expect(personalSum).toBe(3); // 2 + 1 + 0 + 0, the group +1 is excluded
  });

  it("re-grouping carries the student's whole personal score to the new group (组分随人走)", () => {
    // 小明 (+2, earned while in g1) is moved into g3: both points leave g1 with him.
    const moved = moveTo(students, '1', 'g3');
    expect(gScore(moved, events, 'g1')).toBe(2); // 小红+1, 组+1
    expect(gScore(moved, events, 'g3')).toBe(5); // 3 + 小明's 2
  });

  it('moving students back and forth leaves every group score where it started', () => {
    // 小明 g1→g2→g1 and 丽丽 g2→g1→g2: the round trip must not leak points.
    let s = moveTo(moveTo(students, '1', 'g2'), '5', 'g1');
    expect(gScore(s, events, 'g1')).toBe(3); // 小红1 + 丽丽1 + 组1
    expect(gScore(s, events, 'g2')).toBe(5); // 欣欣2 + 小明2 + 组1
    s = moveTo(moveTo(s, '1', 'g1'), '5', 'g2');
    expect(['g1', 'g2', 'g3'].map((g) => gScore(s, events, g))).toEqual([4, 4, 3]);
  });

  it('keeps group-level events on the group even when every member moves out', () => {
    const emptied = students.map((s) => (s.g === 'g1' ? { ...s, g: 'g2' } : s));
    expect(gScore(emptied, events, 'g1')).toBe(1); // only the 组 +1 is left
  });

  it('counts absent and ungrouped students toward no group', () => {
    const absent = students.map((s) => (s.id === '1' ? { ...s, attendance: 'absent' as const } : s));
    expect(gScore(absent, events, 'g1')).toBe(2); // 小明's +2 drops out while 未到
    const ungrouped = moveTo(students, '9', ''); // 军军 +3 → 未分组
    expect(gScore(ungrouped, events, 'g3')).toBe(0); // 婷婷−1 + 组+1
  });

  it('derives the recap 亮眼 / 被提醒 lists from the ledger', () => {
    expect(stars(students, events).map((s) => s.name)).toEqual(['小明', '欣欣', '军军']);
    expect(warned(students, events).map((s) => s.name)).toEqual(['婷婷']);
  });

  it('drops a group point when the last event is undone', () => {
    const undone = events.slice(0, -1); // last event is 组 g3 +1
    expect(gScore(students, undone, 'g3')).toBe(2);
  });
});

// 小组分明细：总分拆成 学生加分累计 / 小组独立加分累计 / 扣分累计 三部分，
// total = studentPlus + groupPlus − minus 恒成立（供小组浮窗展示）。
describe('group score breakdown (gScoreBreakdown)', () => {
  const { students, events } = initialSession();
  const at = '2026-05-29 19:30:00';

  it('splits student-earned vs group-own plus, all clean-positive groups', () => {
    // g1: 小明+2 小红+1（学生）、组+1、无扣分
    expect(gScoreBreakdown(students, events, 'g1')).toEqual({ total: 4, studentPlus: 3, groupPlus: 1, minus: 0 });
  });

  it('accumulates deductions separately instead of netting them away', () => {
    // g3: 军军+3（学生）、组+1、婷婷−1 → 明细里扣分单列
    expect(gScoreBreakdown(students, events, 'g3')).toEqual({ total: 3, studentPlus: 3, groupPlus: 1, minus: 1 });
  });

  it('counts group-level −1 into minus, not into groupPlus', () => {
    const withGroupMinus = events.concat({ id: 98, tt: 'group', tid: 'g3', g: 'g3', d: -1, createdAt: at });
    expect(gScoreBreakdown(students, withGroupMinus, 'g3')).toEqual({
      total: 2,
      studentPlus: 3,
      groupPlus: 1,
      minus: 2,
    });
  });

  it('attributes student events by current membership, ignoring the group stamped on the event', () => {
    // 小明（加分时在 g1）调入 g3：他的 +2 整体随人走
    const moved = moveTo(students, '1', 'g3');
    expect(gScoreBreakdown(moved, events, 'g1')).toEqual({ total: 2, studentPlus: 1, groupPlus: 1, minus: 0 });
    expect(gScoreBreakdown(moved, events, 'g3')).toEqual({ total: 5, studentPlus: 5, groupPlus: 1, minus: 1 });
  });

  it('always satisfies total = studentPlus + groupPlus − minus and matches gScore', () => {
    const moved = moveTo(moveTo(students, '1', 'g3'), '11', 'g2');
    for (const s of [students, moved]) {
      for (const gid of ['g1', 'g2', 'g3']) {
        const b = gScoreBreakdown(s, events, gid);
        expect(b.total).toBe(b.studentPlus + b.groupPlus - b.minus);
        expect(b.total).toBe(gScore(s, events, gid));
      }
    }
  });
});

// 看板视图：小组成员按个人分动态排序，最高分在最上面；同分保持花名册顺序。
describe('board view member ordering (byScoreDesc)', () => {
  const { students, events } = initialSession();
  const g1 = students.filter((s) => s.g === 'g1'); // 小明2 小红1 小刚0 乐乐0
  const g3 = students.filter((s) => s.g === 'g3'); // 军军3 悦悦0 婷婷−1 浩浩0

  it('orders members by personal score, highest first', () => {
    expect(byScoreDesc(g3, events).map((s) => s.name)).toEqual(['军军', '悦悦', '浩浩', '婷婷']);
  });

  it('keeps roster order for equal scores (stable)', () => {
    expect(byScoreDesc(g1, events).map((s) => s.name)).toEqual(['小明', '小红', '小刚', '乐乐']);
  });

  it('re-ranks dynamically as new score events land', () => {
    const at = '2026-05-29 19:30:00';
    const boosted = events.concat(
      { id: 90, tt: 'student', tid: '11', g: 'g3', d: 1, createdAt: at },
      { id: 91, tt: 'student', tid: '11', g: 'g3', d: 1, createdAt: at },
      { id: 92, tt: 'student', tid: '11', g: 'g3', d: 1, createdAt: at },
      { id: 93, tt: 'student', tid: '11', g: 'g3', d: 1, createdAt: at },
    ); // 婷婷 −1 → +3，追平军军但花名册在后
    expect(byScoreDesc(g3, boosted).map((s) => s.name)).toEqual(['军军', '婷婷', '悦悦', '浩浩']);
  });

  it('does not mutate the input array', () => {
    const before = g3.map((s) => s.id);
    byScoreDesc(g3, events);
    expect(g3.map((s) => s.id)).toEqual(before);
  });
});

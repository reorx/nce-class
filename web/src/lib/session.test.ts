import { describe, expect, it } from 'vitest';
import { byScoreDesc, gScore, initialSession, sScore, stars, warned } from './session';

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

  it('derives a group score by nesting student events + group events', () => {
    expect(gScore(events, 'g1')).toBe(4); // 小明+2, 小红+1, 组+1
    expect(gScore(events, 'g2')).toBe(4); // 丽丽+1, 欣欣+2, 组+1
    expect(gScore(events, 'g3')).toBe(3); // 军军+3, 婷婷−1, 组+1
  });

  it('does not fold group-level events into any personal score', () => {
    // g1 has a group +1 event, yet no student in g1 gains it individually.
    const g1Ids = students.filter((s) => s.g === 'g1').map((s) => s.id);
    const personalSum = g1Ids.reduce((a, id) => a + sScore(events, id), 0);
    expect(personalSum).toBe(3); // 2 + 1 + 0 + 0, the group +1 is excluded
  });

  it('re-grouping a student does not rewrite historical group scores', () => {
    // Move 小明 (currently g1) into g3, then add a fresh +1: only the new event
    // counts toward g3; g1 keeps the two historical points 小明 earned there.
    const moved = events.concat({ id: 99, tt: 'student', tid: '1', g: 'g3', d: 1, createdAt: '2026-05-29 19:30:00' });
    expect(gScore(moved, 'g1')).toBe(4); // unchanged history
    expect(gScore(moved, 'g3')).toBe(4); // 3 + the new +1
  });

  it('derives the recap 亮眼 / 被提醒 lists from the ledger', () => {
    expect(stars(students, events).map((s) => s.name)).toEqual(['小明', '欣欣', '军军']);
    expect(warned(students, events).map((s) => s.name)).toEqual(['婷婷']);
  });

  it('drops a group point when the last event is undone', () => {
    const undone = events.slice(0, -1); // last event is 组 g3 +1
    expect(gScore(undone, 'g3')).toBe(2);
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

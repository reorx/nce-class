import { describe, expect, it } from 'vitest';
import {
  addBrush,
  brushIndexOf,
  canSave,
  DEFAULT_BRUSHES,
  initEditor,
  lessonsOn,
  monthGrid,
  monthLabel,
  nextMonth,
  prevMonth,
  removeLesson,
  selectBrush,
  setName,
  sortedLessons,
  toggleDay,
  toPayload,
} from './scheduleEditor';

const TODAY = '2026-07-20';

describe('initEditor', () => {
  it('starts empty with default brushes on today month', () => {
    const s = initEditor({ today: TODAY });
    expect(s.brushes).toEqual(DEFAULT_BRUSHES);
    expect(s.activeBrush).toBe(0);
    expect(s.lessons).toEqual([]);
    expect(s.month).toBe('2026-07');
    expect(canSave(s)).toBe(false);
  });

  it('derives brushes and month from an existing schedule (编辑)', () => {
    const lessons = [
      { date: '2026-08-05', startTime: '19:00', endTime: '21:00' },
      { date: '2026-08-01', startTime: '09:00', endTime: '11:00' },
      { date: '2026-08-08', startTime: '09:00', endTime: '11:00' },
    ];
    const s = initEditor({ name: '八月班', lessons, today: TODAY });
    expect(s.name).toBe('八月班');
    expect(s.brushes).toEqual([
      { startTime: '09:00', endTime: '11:00' },
      { startTime: '19:00', endTime: '21:00' },
    ]);
    expect(s.month).toBe('2026-08'); // 首节所在月
    expect(canSave(s)).toBe(true);
  });
});

describe('toggleDay (时间刷)', () => {
  it('paints, cancels on same brush, replaces on same start different end', () => {
    let s = initEditor({ today: TODAY });
    s = toggleDay(s, '2026-07-25');
    expect(s.lessons).toEqual([{ date: '2026-07-25', startTime: '08:00', endTime: '10:00' }]);

    // 再点同时间取消
    s = toggleDay(s, '2026-07-25');
    expect(s.lessons).toEqual([]);

    // 同 startTime 不同 endTime 的刷子 → 替换
    s = toggleDay(s, '2026-07-25');
    s = addBrush(s, { startTime: '08:00', endTime: '09:30' });
    s = toggleDay(s, '2026-07-25');
    expect(s.lessons).toEqual([{ date: '2026-07-25', startTime: '08:00', endTime: '09:30' }]);
  });

  it('allows a second lesson on the same day with a different brush (同天多节)', () => {
    let s = initEditor({ today: TODAY });
    s = toggleDay(s, '2026-07-25');
    s = selectBrush(s, 1);
    s = toggleDay(s, '2026-07-25');
    expect(lessonsOn(s, '2026-07-25')).toEqual([
      { date: '2026-07-25', startTime: '08:00', endTime: '10:00' },
      { date: '2026-07-25', startTime: '15:00', endTime: '17:00' },
    ]);
  });
});

describe('brushes', () => {
  it('addBrush validates, dedupes and selects', () => {
    let s = initEditor({ today: TODAY });
    s = addBrush(s, { startTime: '19:00', endTime: '21:00' });
    expect(s.brushes).toHaveLength(3);
    expect(s.activeBrush).toBe(2);

    // 重复时间段 → 不新增，只选中
    s = addBrush(s, { startTime: '08:00', endTime: '10:00' });
    expect(s.brushes).toHaveLength(3);
    expect(s.activeBrush).toBe(0);

    // 非法输入 → 原样返回
    expect(addBrush(s, { startTime: '8:00', endTime: '10:00' })).toBe(s);
    expect(addBrush(s, { startTime: '10:00', endTime: '10:00' })).toBe(s);
  });

  it('brushIndexOf maps a lesson back to its brush for coloring', () => {
    let s = initEditor({ today: TODAY });
    s = toggleDay(s, '2026-07-25');
    expect(brushIndexOf(s, s.lessons[0])).toBe(0);
    expect(brushIndexOf(s, { startTime: '00:00', endTime: '01:00' })).toBe(-1);
  });
});

describe('misc operations', () => {
  it('removeLesson removes one 节次 from the side list', () => {
    let s = initEditor({ today: TODAY });
    s = toggleDay(s, '2026-07-25');
    s = selectBrush(s, 1);
    s = toggleDay(s, '2026-07-25');
    s = removeLesson(s, '2026-07-25', '08:00');
    expect(s.lessons).toEqual([{ date: '2026-07-25', startTime: '15:00', endTime: '17:00' }]);
  });

  it('sortedLessons orders by date then time; toPayload carries name + lessons', () => {
    let s = initEditor({ today: TODAY });
    s = toggleDay(s, '2026-07-25');
    s = toggleDay(s, '2026-07-04');
    s = setName(s, ' 七月周期 ');
    expect(sortedLessons(s).map((l) => l.date)).toEqual(['2026-07-04', '2026-07-25']);
    expect(toPayload(s)).toEqual({
      name: '七月周期',
      lessons: [
        { date: '2026-07-04', startTime: '08:00', endTime: '10:00' },
        { date: '2026-07-25', startTime: '08:00', endTime: '10:00' },
      ],
    });
  });

  it('month navigation wraps across years', () => {
    let s = initEditor({ today: '2026-12-15' });
    expect(monthLabel(s.month)).toBe('2026 年 12 月');
    s = nextMonth(s);
    expect(s.month).toBe('2027-01');
    s = prevMonth(prevMonth(s));
    expect(s.month).toBe('2026-11');
  });
});

describe('monthGrid', () => {
  it('renders 42 Monday-first cells covering the whole month', () => {
    const cells = monthGrid('2026-07');
    expect(cells).toHaveLength(42);
    // 2026-07-01 是周三 → 首格回退到周一 06-29（mockup 同款）
    expect(cells[0]).toEqual({ date: '2026-06-29', day: 29, inMonth: false });
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31);
    expect(cells.find((c) => c.date === '2026-07-01')).toEqual({ date: '2026-07-01', day: 1, inMonth: true });
  });

  it('handles a month starting on Monday', () => {
    const cells = monthGrid('2026-06'); // 2026-06-01 是周一
    expect(cells[0]).toEqual({ date: '2026-06-01', day: 1, inMonth: true });
    expect(cells.filter((c) => c.inMonth)).toHaveLength(30);
  });
});

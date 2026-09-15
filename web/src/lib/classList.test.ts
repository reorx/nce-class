import { describe, expect, it } from 'vitest';
import { classListView } from './classList';

const cls = (name: string, studentCount: number, isArchived = false) => ({ name, studentCount, isArchived });

describe('classListView', () => {
  const classes = [
    cls('三年级A班', 13, false),
    cls('三年级B班', 9, true),
    cls('四年级C班', 11),
    cls('暑期班', 6, true),
  ];
  const names = (cs: { name: string }[]) => cs.map((c) => c.name);

  it('home shows only unarchived classes, counts only them, and counts the archived ones for the entry link', () => {
    const v = classListView(classes, { archived: false, search: '' });
    expect(names(v.list)).toEqual(['三年级A班', '四年级C班']);
    expect(v.classCount).toBe(2);
    expect(v.studentTotal).toBe(24);
    expect(v.archivedCount).toBe(2);
  });

  it('archived page shows only archived classes', () => {
    const v = classListView(classes, { archived: true, search: '' });
    expect(names(v.list)).toEqual(['三年级B班', '暑期班']);
    expect(v.classCount).toBe(2);
    expect(v.studentTotal).toBe(15);
    expect(v.archivedCount).toBe(2);
  });

  it('search narrows the list within the current mode only; the counts stay the whole mode', () => {
    const home = classListView(classes, { archived: false, search: ' 三年级 ' });
    expect(names(home.list)).toEqual(['三年级A班']); // 三年级B班 is archived → never on home
    expect(home.classCount).toBe(2);
    expect(home.studentTotal).toBe(24);

    expect(names(classListView(classes, { archived: true, search: '三年级' }).list)).toEqual(['三年级B班']);
    expect(classListView(classes, { archived: true, search: '五年级' }).list).toEqual([]);
  });

  it('no archived classes → archivedCount 0 (home hides the entry), empty archived page', () => {
    const none = [cls('A', 1), cls('B', 2)];
    expect(classListView(none, { archived: false, search: '' }).archivedCount).toBe(0);
    expect(classListView(none, { archived: true, search: '' })).toEqual({
      list: [],
      classCount: 0,
      studentTotal: 0,
      archivedCount: 0,
    });
  });
});

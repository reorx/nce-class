import { describe, expect, it } from 'vitest';
import type { ClassDetail } from './api';
import { addGroup, moveStudent, removeGroup, renameGroup, toModel, toPayload } from './grouping';

// Minimal class-detail slice mirroring the 分组方案 tab's inputs.
const detail = {
  students: [
    { id: 's1', groupId: 'g1', status: 'active' },
    { id: 's2', groupId: 'g1', status: 'active' },
    { id: 's3', groupId: 'g2', status: 'active' },
    { id: 's4', groupId: null, status: 'active' },
  ],
  groups: [
    { id: 'g1', name: '第1组', emoji: '🦁', orderIndex: 0, memberIds: ['s1', 's2'] },
    { id: 'g2', name: '第2组', emoji: '🐯', orderIndex: 1, memberIds: ['s3'] },
  ],
} as unknown as ClassDetail;

describe('grouping model', () => {
  it('builds groups + ungrouped from class detail', () => {
    const m = toModel(detail);
    expect(m.groups.map((g) => g.memberIds)).toEqual([['s1', 's2'], ['s3']]);
    expect(m.ungrouped).toEqual(['s4']);
  });

  it('keeps suspended/archived students out of the ungrouped pool', () => {
    const d = {
      ...detail,
      students: [
        ...(detail.students as unknown as any[]),
        { id: 's5', groupId: null, status: 'suspended' },
        { id: 's6', groupId: null, status: 'archived' },
      ],
    } as unknown as ClassDetail;
    const m = toModel(d);
    expect(m.ungrouped).toEqual(['s4']);
  });

  it('moves a student between groups without duplicating them', () => {
    let m = toModel(detail);
    m = moveStudent(m, 's1', 'g2');
    expect(m.groups[0].memberIds).toEqual(['s2']);
    expect(m.groups[1].memberIds).toEqual(['s3', 's1']);
    expect(m.ungrouped).toEqual(['s4']);
  });

  it('moves a student to and from the ungrouped pool', () => {
    let m = toModel(detail);
    m = moveStudent(m, 's3', null);
    expect(m.groups[1].memberIds).toEqual([]);
    expect(m.ungrouped).toEqual(['s4', 's3']);
    m = moveStudent(m, 's4', 'g1');
    expect(m.groups[0].memberIds).toEqual(['s1', 's2', 's4']);
    expect(m.ungrouped).toEqual(['s3']);
  });

  it('adds a group with a fresh client id and removes one back to ungrouped', () => {
    let m = addGroup(toModel(detail));
    expect(m.groups).toHaveLength(3);
    expect(m.groups[2].id).toBe('new-1');
    m = moveStudent(m, 's4', 'new-1');
    m = removeGroup(m, 'g2'); // s3 falls back to ungrouped
    expect(m.groups.map((g) => g.id)).toEqual(['g1', 'new-1']);
    expect(m.ungrouped).toEqual(['s3']);
  });

  it('renames a group', () => {
    const m = renameGroup(toModel(detail), 'g1', '龙队');
    expect(m.groups[0].name).toBe('龙队');
  });

  it('serializes to a replace payload with orderIndex following array order', () => {
    const m = addGroup(toModel(detail));
    const payload = toPayload(m);
    expect(payload.map((g) => [g.id, g.orderIndex])).toEqual([
      ['g1', 0],
      ['g2', 1],
      ['new-1', 2],
    ]);
    expect(payload[0].memberIds).toEqual(['s1', 's2']);
  });
});

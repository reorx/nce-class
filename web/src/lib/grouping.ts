import type { ClassDetail, GroupSave } from './api';

// Editable in-memory model for the 分组方案 tab. Operations are pure and return
// a fresh model so the component can optimistically apply then roll back on a
// failed save.
export interface EditGroup {
  id: string; // real class_group id, or a `new-N` client id for unsaved groups
  name: string;
  emoji: string | null;
  memberIds: string[];
}
export interface GroupingModel {
  groups: EditGroup[];
  ungrouped: string[]; // student ids not in any group
}

const EMOJIS = ['🦁', '🐯', '🐻', '🐼', '🦊', '🐨', '🐸', '🐧', '🦉', '🐰'];

export function toModel(d: Pick<ClassDetail, 'students' | 'groups'>): GroupingModel {
  const groups = d.groups
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((g) => ({ id: g.id, name: g.name, emoji: g.emoji, memberIds: g.memberIds.slice() }));
  // Only active students sit in the ungrouped pool — suspended/archived ones
  // are not draggable into groups (they'd be filtered out server-side anyway).
  const ungrouped = d.students.filter((s) => s.groupId == null && s.status === 'active').map((s) => s.id);
  return { groups, ungrouped };
}

/** Move a student into a group, or to the ungrouped pool when target is null. */
export function moveStudent(m: GroupingModel, studentId: string, targetGroupId: string | null): GroupingModel {
  const groups = m.groups.map((g) => ({ ...g, memberIds: g.memberIds.filter((id) => id !== studentId) }));
  let ungrouped = m.ungrouped.filter((id) => id !== studentId);
  if (targetGroupId == null) {
    ungrouped = [...ungrouped, studentId];
  } else {
    const gi = groups.findIndex((g) => g.id === targetGroupId);
    if (gi >= 0) groups[gi] = { ...groups[gi], memberIds: [...groups[gi].memberIds, studentId] };
    else ungrouped = [...ungrouped, studentId]; // unknown target → keep the student visible
  }
  return { groups, ungrouped };
}

function nextNewId(groups: EditGroup[]): string {
  let max = 0;
  for (const g of groups) {
    const mm = /^new-(\d+)$/.exec(g.id);
    if (mm) max = Math.max(max, Number(mm[1]));
  }
  return `new-${max + 1}`;
}

export function addGroup(m: GroupingModel): GroupingModel {
  const n = m.groups.length + 1;
  const group: EditGroup = {
    id: nextNewId(m.groups),
    name: `第${n}组`,
    emoji: EMOJIS[(n - 1) % EMOJIS.length],
    memberIds: [],
  };
  return { ...m, groups: [...m.groups, group] };
}

/** Remove a group; its members fall back to ungrouped. */
export function removeGroup(m: GroupingModel, groupId: string): GroupingModel {
  const g = m.groups.find((x) => x.id === groupId);
  return {
    groups: m.groups.filter((x) => x.id !== groupId),
    ungrouped: g ? [...m.ungrouped, ...g.memberIds] : m.ungrouped,
  };
}

export function renameGroup(m: GroupingModel, groupId: string, name: string): GroupingModel {
  return { ...m, groups: m.groups.map((g) => (g.id === groupId ? { ...g, name } : g)) };
}

/** Serialize for `PUT /api/classes/:id/groups`; orderIndex follows array order. */
export function toPayload(m: GroupingModel): GroupSave[] {
  return m.groups.map((g, i) => ({
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    orderIndex: i,
    memberIds: g.memberIds,
  }));
}

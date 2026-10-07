import type { QueryClient, QueryKey } from '@tanstack/react-query';
import {
  adminKeys,
  attendanceKeys,
  authKeys,
  billingKeys,
  classKeys,
  inviteKeys,
  scheduleKeys,
  sessionKeys,
  studentKeys,
  tagKeys,
  teacherKeys,
} from '../queries/keys';
import * as f from './fixtures';

// 写后缓存矩阵测试用的「全量缓存」：两个班（c1 / c2）各自的详情、课堂、档案、考勤、排班、收费都已缓存。
// 跑完一个写操作后用 snapshot() 看每条缓存是被移除、失效还是数据被改写，与期望集合逐一比对。

const c1Session = f.session({ id: 'x1' });
const c1Session2 = f.session({ id: 'x2', date: '9月24日' });
const c2Session = f.session({ id: 'x9' });

const universe: Record<string, [QueryKey, unknown]> = {
  me: [authKeys.me(), f.me()],
  teachers: [teacherKeys.lists(), [f.teacher(), f.teacher({ id: 't2', name: '李老师', username: 'li' })]],
  tags: [tagKeys.lists(), [{ id: 'g1', name: '专注之星' }]],
  'admin/classes': [adminKeys.classes(), [f.adminClass(), f.adminClass({ id: 'c2', name: '四年级B班' })]],
  'classes/list': [classKeys.lists(), [f.classListItem(), f.classListItem({ id: 'c2', name: '四年级B班' })]],
  'classes/c1': [classKeys.detail('c1'), f.classDetail({ sessions: [c1Session, c1Session2] })],
  'classes/c2': [
    classKeys.detail('c2'),
    f.classDetail({
      id: 'c2',
      name: '四年级B班',
      students: [f.student({ id: 's9', name: 'Amy' })],
      sessions: [c2Session],
    }),
  ],
  'profile/s1': [studentKeys.profile('s1'), f.profile()],
  'profile/s9': [
    studentKeys.profile('s9'),
    f.profile({ student: { ...f.profile().student, id: 's9', name: 'Amy' }, class: { id: 'c2', name: '四年级B班' } }),
  ],
  'sessions/list': [sessionKeys.lists(), [f.sessionListItem(), f.sessionListItem({ id: 'x9', classId: 'c2' })]],
  'sessions/x1': [sessionKeys.detail('x1'), f.sessionDetail({ id: 'x1' })],
  'sessions/x2': [sessionKeys.detail('x2'), f.sessionDetail({ id: 'x2' })],
  'sessions/x9': [sessionKeys.detail('x9'), f.sessionDetail({ id: 'x9', classId: 'c2', className: '四年级B班' })],
  'attendance/c1': [attendanceKeys.byClass('c1'), f.attendance()],
  'attendance/c2': [
    attendanceKeys.byClass('c2'),
    f.attendance({
      classId: 'c2',
      sessions: [{ id: 'x9', date: '2026-10-01', startedAt: null, lessonNumber: 7, lessonTitle: null }],
      students: [{ id: 's9', name: 'Amy', cnName: null, status: 'active' }],
      records: [{ sessionId: 'x9', studentId: 's9', status: 'present', madeUp: false }],
    }),
  ],
  'invites/c1': [inviteKeys.requests('c1'), []],
  'invites/c2': [inviteKeys.requests('c2'), []],
  'schedules/list/c1': [scheduleKeys.list('c1'), [f.scheduleItem({ batchId: 'b1' })]],
  'schedules/list/c2': [scheduleKeys.list('c2'), [f.scheduleItem({ id: 'p9', batchId: 'b9' })]],
  'schedules/p1': [scheduleKeys.detail('p1'), f.scheduleDetail({ batchId: 'b1' })],
  'schedules/p9': [scheduleKeys.detail('p9'), f.scheduleDetail({ id: 'p9', batchId: 'b9' })],
  'billing/list': [billingKeys.lists(), [f.batchItem(), f.batchItem({ id: 'b9', classId: 'c2', scheduleId: 'p9' })]],
  'billing/b1': [billingKeys.detail('b1'), f.batchDetail()],
  'billing/b9': [
    billingKeys.detail('b9'),
    f.batchDetail({ id: 'b9', classId: 'c2', scheduleId: 'p9', invoices: [f.invoice({ id: 'i9', studentId: 's9' })] }),
  ],
  'invoice-lessons/i1': [billingKeys.invoiceLessons('i1'), f.invoiceLessons()],
  'invoice-lessons/i9': [billingKeys.invoiceLessons('i9'), f.invoiceLessons({ invoiceId: 'i9', studentId: 's9' })],
};

export const universeNames = Object.keys(universe);

export function seedUniverse(client: QueryClient, skip: string[] = []) {
  for (const [name, [key, data]] of Object.entries(universe)) {
    if (!skip.includes(name)) client.setQueryData(key, data);
  }
}

export interface CacheSnapshot {
  removed: string[];
  invalidated: string[];
  changed: string[];
}

/** 对照 seed 时的数据：哪些条目被移除、被标记失效、数据被改写（引用变化即算）。 */
export function snapshot(client: QueryClient, skip: string[] = []): CacheSnapshot {
  const result: CacheSnapshot = { removed: [], invalidated: [], changed: [] };
  for (const [name, [key, data]] of Object.entries(universe)) {
    if (skip.includes(name)) continue;
    const state = client.getQueryState(key);
    if (!state) {
      result.removed.push(name);
      continue;
    }
    if (state.isInvalidated) result.invalidated.push(name);
    if (state.data !== data) result.changed.push(name);
  }
  return result;
}

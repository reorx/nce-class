import type { AdminClassItem } from '../api/admin';
import type { ClassAttendance } from '../api/attendance';
import type { Me } from '../api/auth';
import type { BillingBatchDetail, BillingBatchItem, InvoiceItem, InvoiceLessons } from '../api/billing';
import type { ClassDetail, ClassListItem } from '../api/classes';
import type { ScheduleDetail, ScheduleItem } from '../api/schedules';
import type { Recap, Session, SessionDetail, SessionListItem } from '../api/sessions';
import type { Student, StudentProfile } from '../api/students';
import type { TeacherItem } from '../api/teachers';

// 测试用最小合法 DTO。只保证类型完整，字段值按用例需要覆盖。

export const me = (over: Partial<Me> = {}): Me => ({
  id: 't1',
  name: '王丽',
  username: 'wangli',
  role: 'teacher',
  isAdmin: false,
  orgName: '示例学校',
  ...over,
});

export const teacher = (over: Partial<TeacherItem> = {}): TeacherItem => ({
  id: 't1',
  name: '王丽',
  username: 'wangli',
  role: 'teacher',
  isAdmin: false,
  ...over,
});

export const student = (over: Partial<Student> = {}): Student => ({
  id: 's1',
  name: 'Tom',
  cnName: '汤姆',
  source: 'teacher',
  status: 'active',
  hasPhoto: false,
  score: 0,
  groupId: null,
  ...over,
});

export const session = (over: Partial<Session> = {}): Session => ({
  id: 'x1',
  date: '10月1日',
  year: '2026',
  weekday: '周四',
  lessonNumber: 7,
  lessonTitle: 'Too late',
  teacherId: 't1',
  teacherName: '王丽',
  plannedDurationMin: 120,
  actualDurationMin: 115,
  durationLabel: '1小时55分',
  startedAt: '2026-10-01 18:00:00',
  endedAt: '2026-10-01 19:55:00',
  groupCount: 2,
  hasHomework: true,
  attendancePresent: 1,
  attendanceTotal: 1,
  ...over,
});

export const recap = (over: Partial<Recap> = {}): Recap => ({
  date: '10月1日',
  weekday: '周四',
  lessonNumber: 7,
  lessonTitle: 'Too late',
  actualDurationMin: 115,
  attendancePresent: 1,
  attendanceTotal: 1,
  groups: [
    { name: '海豚组', emoji: '🐬', orderIndex: 0, score: 3 },
    { name: '狮子组', emoji: '🦁', orderIndex: 1, score: 5 },
  ],
  stars: [{ name: 'Tom', net: 3 }],
  warned: [],
  studentTags: [],
  ...over,
});

export const classDetail = (over: Partial<ClassDetail> = {}): ClassDetail => ({
  id: 'c1',
  name: '三年级A班',
  notes: null,
  textbook: '1',
  isArchived: false,
  homeworkTemplate: null,
  teacherId: 't1',
  teacherName: '王丽',
  studentCount: 1,
  groupCount: 0,
  sessionCount: 1,
  students: [student()],
  groups: [],
  sessions: [session()],
  lastRecap: null,
  ...over,
});

export const classListItem = (over: Partial<ClassListItem> = {}): ClassListItem => ({
  id: 'c1',
  name: '三年级A班',
  teacherName: '王丽',
  textbook: '1',
  isArchived: false,
  studentCount: 1,
  roster: ['Tom'],
  lastSession: null,
  ...over,
});

export const sessionListItem = (over: Partial<SessionListItem> = {}): SessionListItem => ({
  ...session(),
  classId: 'c1',
  className: '三年级A班',
  ...over,
});

export const sessionDetail = (over: Partial<SessionDetail> = {}): SessionDetail => ({
  ...session(),
  classId: 'c1',
  className: '三年级A班',
  classTextbook: '1',
  homeworkTemplate: null,
  homeworkContent: '背诵第7课',
  reviewBook: null,
  reviewLesson: null,
  prevHomework: null,
  recap: recap(),
  overview: {
    totalStudents: 1,
    present: ['Tom'],
    absent: [],
    classScore: 8,
    homework: { done: [], redo: [], miss: [] },
    recitation: { full: [], part: [], none: [], unchecked: [] },
    groups: [],
  },
  ledger: { clientSessionId: null, sessionGroups: [], memberships: [], events: [], checks: [], tags: [] },
  ...over,
});

export const profile = (over: Partial<StudentProfile> = {}): StudentProfile => ({
  student: { id: 's1', name: 'Tom', cnName: '汤姆', source: 'teacher', status: 'active', photoUrl: null },
  class: { id: 'c1', name: '三年级A班' },
  currentGroup: null,
  totals: { attended: 1, personalTotal: 3, plus: 3, minus: 0 },
  sessions: [],
  ...over,
});

export const attendance = (over: Partial<ClassAttendance> = {}): ClassAttendance => ({
  classId: 'c1',
  className: '三年级A班',
  sessions: [{ id: 'x1', date: '2026-10-01', startedAt: null, lessonNumber: 7, lessonTitle: null }],
  students: [{ id: 's1', name: 'Tom', cnName: '汤姆', status: 'active' }],
  records: [{ sessionId: 'x1', studentId: 's1', status: 'present', madeUp: false }],
  ...over,
});

export const scheduleItem = (over: Partial<ScheduleItem> = {}): ScheduleItem => ({
  id: 'p1',
  name: '秋季',
  createdAt: '2026-09-01 10:00:00',
  lessonCount: 1,
  minDate: '2026-10-01',
  maxDate: '2026-10-01',
  batchId: null,
  ...over,
});

export const scheduleDetail = (over: Partial<ScheduleDetail> = {}): ScheduleDetail => ({
  ...scheduleItem(),
  lessons: [{ id: 'l1', date: '2026-10-01', startTime: '18:00', endTime: '20:00' }],
  ...over,
});

export const invoice = (over: Partial<InvoiceItem> = {}): InvoiceItem => ({
  id: 'i1',
  studentId: 's1',
  studentName: 'Tom',
  studentCnName: '汤姆',
  studentStatus: 'active',
  attendedCount: 1,
  plannedCount: 1,
  billableCount: 1,
  unitPriceCents: 15000,
  computedAmountCents: 15000,
  finalAmountCents: 15000,
  adjusted: 0,
  note: null,
  status: 'pending',
  paidAt: null,
  paidByName: null,
  ...over,
});

export const batchItem = (over: Partial<BillingBatchItem> = {}): BillingBatchItem => ({
  id: 'b1',
  classId: 'c1',
  className: '三年级A班',
  scheduleId: 'p1',
  scheduleName: '秋季',
  lessonCount: 1,
  scheduleLessonCount: 1,
  lessonCountOverride: null,
  minDate: '2026-10-01',
  maxDate: '2026-10-01',
  heldSessionCount: 1,
  futureLessonCount: 0,
  unitPriceCents: 15000,
  addonCents: 0,
  addonNote: null,
  snapshotAt: '2026-10-02 10:00:00',
  createdAt: '2026-10-02 10:00:00',
  invoiceCount: 1,
  paidCount: 0,
  paidAmountCents: 0,
  pendingAmountCents: 15000,
  totalAmountCents: 15000,
  ...over,
});

export const batchDetail = (over: Partial<BillingBatchDetail> = {}): BillingBatchDetail => ({
  ...batchItem(),
  invoices: [invoice()],
  ...over,
});

export const invoiceLessons = (over: Partial<InvoiceLessons> = {}): InvoiceLessons => ({
  invoiceId: 'i1',
  studentId: 's1',
  rows: [{ kind: 'session', date: '2026-10-01', startTime: '18:00', sessionId: 'x1', attendance: 'present' }],
  ...over,
});

export const adminClass = (over: Partial<AdminClassItem> = {}): AdminClassItem => ({
  id: 'c1',
  name: '三年级A班',
  teacherName: '王丽',
  studentCount: 1,
  sessionCount: 1,
  scheduleCount: 1,
  batchCount: 1,
  invoiceCount: 1,
  paidInvoiceCount: 0,
  paidAmountCents: 0,
  ...over,
});

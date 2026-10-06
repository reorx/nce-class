// ⚠️ 迁移期兼容出口（Plan 2 迁移完成后删除）。新代码：组件用 queries/<domain> 的 hooks，
// 类型从 api/<domain> 导入。这里保持旧方法名、签名、返回值与错误语义不变：
// - 读取直接委托领域 API；
// - 写入委托领域 API，成功后执行与领域 Mutation 相同的 cache-effects，让尚未迁移的页面
//   写入后，已迁移页面的缓存也随之失效；发起时记下会话代次，身份已切换则跳过缓存写入；
// - 登录 / 退出走同一套会话切换（取消并清空服务端缓存，本地课堂草稿不动）。

import type { QueryClient } from '@tanstack/react-query';
import * as admin from '../api/admin';
import * as attendance from '../api/attendance';
import * as auth from '../api/auth';
import * as billing from '../api/billing';
import * as classes from '../api/classes';
import * as invites from '../api/invites';
import * as schedules from '../api/schedules';
import * as sessions from '../api/sessions';
import * as students from '../api/students';
import * as tags from '../api/tags';
import * as teachers from '../api/teachers';
import * as effects from '../queries/cache-effects';
import { queryClient } from '../queries/client';
import { sessionGeneration, switchSession } from '../queries/session';
import type { BookKey } from './homework';

export { ApiError } from '../api/client';
export type { AdminClassItem } from '../api/admin';
export type {
  AttendanceRecord,
  AttendanceSession,
  AttendanceStatus,
  AttendanceStudent,
  ClassAttendance,
} from '../api/attendance';
export type { Me } from '../api/auth';
export type { BillingBatchDetail, BillingBatchItem, InvoiceItem, InvoiceLessonRow } from '../api/billing';
export type { ClassDetail, ClassListItem, Group, GroupSave } from '../api/classes';
export type { JoinRequestItem } from '../api/invites';
export type { ScheduleDetail, ScheduleItem, ScheduleLessonItem } from '../api/schedules';
export type {
  CommitGroup,
  CommitPayload,
  CommitResult,
  LastRecap,
  OverviewGroup,
  OverviewMember,
  PrevHomework,
  Recap,
  RecapGroup,
  RecapMember,
  RecapStar,
  RecapStudentTags,
  Session,
  SessionDetail,
  SessionLedger,
  SessionListItem,
  SessionOverview,
} from '../api/sessions';
export type {
  ProfileMine,
  ProfileSession,
  Student,
  StudentBasic,
  StudentProfile,
  StudentStatus,
} from '../api/students';
export type { TagItem } from '../api/tags';
export type { TeacherItem } from '../api/teachers';

/** 写入成功后执行缓存规则；会话已切换（登录/退出/过期）则不写缓存。返回值与错误原样透传。 */
async function write<T>(send: () => Promise<T>, effect?: (client: QueryClient, data: T) => unknown): Promise<T> {
  const generation = sessionGeneration(queryClient);
  const data = await send();
  if (effect && generation === sessionGeneration(queryClient)) await effect(queryClient, data);
  return data;
}

export const api = {
  me: () => auth.getMe(),
  login: (username: string, password: string) =>
    auth.login(username, password).then(async (m) => {
      await switchSession(queryClient, m);
      return m;
    }),
  logout: () =>
    auth.logout().then(async (r) => {
      await switchSession(queryClient, null);
      return r;
    }),
  verifyPassword: (password: string) => auth.verifyPassword(password),
  teachers: () => teachers.listTeachers(),
  orgTags: () => tags.listTags(),
  updateTeacher: (id: string, p: { name: string }) =>
    write(() => teachers.updateTeacher(id, p), effects.teacherUpdated),
  adminClasses: () => admin.listAdminClasses(),
  adminCreateTeacher: (p: admin.CreateTeacherInput) =>
    write(
      () => admin.createAdminTeacher(p),
      (client) => effects.teacherCreated(client),
    ),
  adminDeleteClass: (classId: string, adminPassword: string) =>
    write(
      () => admin.deleteAdminClass(classId, adminPassword),
      (client) => effects.adminClassDeleted(client, classId),
    ),
  adminResetPassword: (teacherId: string, password: string, adminPassword: string) =>
    admin.resetAdminTeacherPassword(teacherId, password, adminPassword),
  classes: () => classes.listClasses(),
  classDetail: (id: string) => classes.getClass(id),
  createClass: (p: classes.CreateClassInput) => write(() => classes.createClass(p), effects.classCreated),
  updateClassInfo: (
    classId: string,
    p: { name: string; teacherId: string; textbook: BookKey | null; isArchived?: boolean },
  ) => write(() => classes.updateClass(classId, p), effects.classInfoUpdated),
  addStudent: (classId: string, p: students.StudentInput) =>
    write(
      () => students.createStudent(classId, p),
      (client) => effects.studentCreated(client, classId),
    ),
  updateStudent: (id: string, p: students.StudentInput) =>
    write(() => students.updateStudent(id, p), effects.studentRenamed),
  deleteStudent: (id: string) =>
    write(
      () => students.deleteStudent(id),
      (client) => effects.studentDeleted(client, id),
    ),
  setStudentStatus: (id: string, status: students.StudentStatus) =>
    write(() => students.updateStudentStatus(id, status), effects.studentStatusChanged),
  listSessions: () => sessions.listSessions(),
  deleteSession: (id: string) =>
    write(
      () => sessions.deleteSession(id),
      (client) => effects.sessionDeleted(client, id),
    ),
  updateSessionInfo: (id: string, p: sessions.UpdateSessionInput) =>
    write(() => sessions.updateSession(id, p), effects.sessionInfoUpdated),
  saveGrouping: (classId: string, groups: classes.GroupSave[]) =>
    write(() => classes.saveClassGrouping(classId, groups), effects.classGroupingSaved),
  updateClassNotes: (classId: string, notes: string) =>
    write(() => classes.updateClassNotes(classId, notes), effects.classNotesSaved),
  updateHomeworkTemplate: (classId: string, template: string) =>
    write(() => classes.updateHomeworkTemplate(classId, template), effects.homeworkTemplateSaved),
  sessionDetail: (sessionId: string) => sessions.getSession(sessionId),
  saveSessionHomework: (sessionId: string, p: sessions.SessionHomeworkInput) =>
    write(() => sessions.updateSessionHomework(sessionId, p), effects.sessionHomeworkUpdated),
  getStudentProfile: (studentId: string) => students.getStudentProfile(studentId),
  getJoinRequests: (classId: string) => invites.listJoinRequests(classId),
  commitSession: (classId: string, payload: sessions.CommitPayload) =>
    write(
      () => sessions.commitSession(classId, payload),
      (client) => effects.sessionCommitted(client, classId),
    ),
  overwriteSession: (sessionId: string, payload: sessions.CommitPayload) =>
    write(
      () => sessions.overwriteSession(sessionId, payload),
      (client) => effects.sessionOverwritten(client, sessionId),
    ),
  classAttendance: (classId: string) => attendance.getClassAttendance(classId),
  updateAttendance: (sessionId: string, studentId: string, p: attendance.AttendanceInput) =>
    write(() => attendance.updateAttendance(sessionId, studentId, p), effects.attendanceUpdated),
  listSchedules: (classId: string) => schedules.listSchedules(classId),
  createSchedule: (classId: string, p: { name: string; lessons: schedules.ScheduleLessonInput[] }) =>
    write(
      () => schedules.createSchedule(classId, p),
      (client, d) => effects.scheduleSaved(client, d, classId),
    ),
  scheduleDetail: (id: string) => schedules.getSchedule(id),
  updateSchedule: (id: string, p: { name?: string; lessons?: schedules.ScheduleLessonInput[] }) =>
    write(() => schedules.updateSchedule(id, p), effects.scheduleSaved),
  deleteSchedule: (id: string) =>
    write(
      () => schedules.deleteSchedule(id),
      (client) => effects.scheduleDeleted(client, id),
    ),
  listBillingBatches: () => billing.listBillingBatches(),
  createBillingBatch: (p: billing.CreateBillingBatchInput) =>
    write(() => billing.createBillingBatch(p), effects.billingBatchCreated),
  billingBatchDetail: (id: string) => billing.getBillingBatch(id),
  recalculateBillingBatch: (id: string, p?: billing.BillingTermsInput) =>
    write(() => billing.recalculateBillingBatch(id, p), effects.billingBatchRecalculated),
  deleteBillingBatch: (id: string) =>
    write(
      () => billing.deleteBillingBatch(id),
      (client) => effects.billingBatchDeleted(client, id),
    ),
  updateInvoice: (id: string, p: billing.UpdateInvoiceInput) =>
    write(() => billing.updateInvoice(id, p), effects.invoiceChanged),
  confirmInvoice: (id: string) => write(() => billing.confirmInvoice(id), effects.invoiceChanged),
  unconfirmInvoice: (id: string) => write(() => billing.unconfirmInvoice(id), effects.invoiceChanged),
  invoiceLessons: (id: string) => billing.getInvoiceLessons(id),
};

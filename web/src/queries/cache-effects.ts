import { hashKey, type Query, type QueryClient, type QueryKey } from '@tanstack/react-query';
import type { AttendanceRecord, ClassAttendance } from '../api/attendance';
import type { Me } from '../api/auth';
import type { BillingBatchDetail, BillingBatchItem, InvoiceItem, InvoiceLessons } from '../api/billing';
import type { ClassDetail } from '../api/classes';
import type { ScheduleDetail, ScheduleItem } from '../api/schedules';
import type { SessionDetail } from '../api/sessions';
import type { StudentBasic, StudentProfile } from '../api/students';
import type { TeacherItem } from '../api/teachers';
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
} from './keys';

// 写后缓存规则：按业务动作组织，领域 Mutation 与迁移期兼容桥（lib/api）共用。
// - 响应与 GET 同形时直接写入精确详情；StudentBasic、CommitResult、InvoiceItem 这类片段不冒充完整详情。
// - 「失效」= 标记过期，活跃查询后台重取，未挂载的等下次使用；不全局失效。
// - 有 classId 等上下文就收窄；缓存里找不到归属时对该领域前缀保守失效，不为找归属发请求。
// - 真正删除的实体移除缓存（移除即静默取消在途请求），旧响应不会让它复活。
// 每个函数返回的 promise 只在活跃查询重取结束后 resolve，且不会因重取失败而 reject。

type AnyQuery = Query<unknown, Error, unknown, QueryKey>;
type Predicate = (query: AnyQuery) => boolean;

const dataOf = <T>(query: AnyQuery) => query.state.data as T | undefined;

/** 按缓存数据判定归属；没有上下文 ID 或该查询还没数据时无法判定，保守算作命中。 */
function owned<T>(id: string | undefined, idOf: (data: T) => string | undefined): Predicate {
  return (query) => {
    const data = dataOf<T>(query);
    return id === undefined || data === undefined || idOf(data) === id;
  };
}

const sessionsOfClass = (classId: string | undefined) => owned<SessionDetail>(classId, (d) => d.classId);
const profilesOfClass = (classId: string | undefined) => owned<StudentProfile>(classId, (d) => d.class.id);
const batchesOfClass = (classId: string | undefined) => owned<BillingBatchDetail>(classId, (d) => d.classId);
const invoiceLessonsOfStudent = (studentId: string) => owned<InvoiceLessons>(studentId, (d) => d.studentId);

const except =
  (key: QueryKey, predicate: Predicate): Predicate =>
  (query) =>
    query.queryHash !== hashKey(key) && predicate(query);

const classDetailKey = (classId: string | undefined) => (classId ? classKeys.detail(classId) : classKeys.details());
const attendanceKey = (classId: string | undefined) =>
  classId ? attendanceKeys.byClass(classId) : attendanceKeys.classes();
const scheduleListKey = (classId: string | undefined) => (classId ? scheduleKeys.list(classId) : scheduleKeys.lists());

const invalidate = (client: QueryClient, queryKey: QueryKey, predicate?: Predicate) =>
  client.invalidateQueries({ queryKey, predicate });

const all = (...tasks: Promise<unknown>[]) => Promise.all(tasks).then(() => undefined);

/** 写入完整响应前先取消该 key 的在途读取：写入前发出的旧 GET 晚到时不能覆盖新数据。 */
async function put<T>(client: QueryClient, key: QueryKey, data: T) {
  await client.cancelQueries({ queryKey: key, exact: true });
  client.setQueryData(key, data);
}

function cachedData<T>(client: QueryClient, prefix: QueryKey): T[] {
  return client
    .getQueriesData<T>({ queryKey: prefix })
    .map(([, data]) => data)
    .filter((data): data is T => data !== undefined);
}

// ---- 从缓存采集归属（只读缓存，不发请求） -------------------------------------

function classIdOfStudent(client: QueryClient, studentId: string): string | undefined {
  const profile = client.getQueryData<StudentProfile>(studentKeys.profile(studentId));
  if (profile) return profile.class.id;
  return cachedData<ClassDetail>(client, classKeys.details()).find((c) => c.students.some((s) => s.id === studentId))
    ?.id;
}

function classIdOfSession(client: QueryClient, sessionId: string): string | undefined {
  const detail = client.getQueryData<SessionDetail>(sessionKeys.detail(sessionId));
  if (detail) return detail.classId;
  return (
    cachedData<ClassDetail>(client, classKeys.details()).find((c) => c.sessions.some((s) => s.id === sessionId))?.id ??
    cachedData<ClassAttendance>(client, attendanceKeys.classes()).find((a) =>
      a.sessions.some((s) => s.id === sessionId),
    )?.classId
  );
}

function classIdOfSchedule(client: QueryClient, scheduleId: string): string | undefined {
  const lists = client.getQueriesData<ScheduleItem[]>({ queryKey: scheduleKeys.lists() });
  const hit = lists.find(([, items]) => items?.some((s) => s.id === scheduleId));
  return hit ? (hit[0][2] as string) : undefined;
}

// ---- 班级 -------------------------------------------------------------------

export async function classCreated(client: QueryClient, detail: ClassDetail) {
  await put(client, classKeys.detail(detail.id), detail);
  await all(invalidate(client, classKeys.lists()), invalidate(client, adminKeys.all));
}

/** 名称 / 负责老师 / 教材 / 归档：其他领域里嵌着班级名的展示一并刷新。 */
export async function classInfoUpdated(client: QueryClient, detail: ClassDetail) {
  await put(client, classKeys.detail(detail.id), detail);
  await all(
    invalidate(client, classKeys.lists()),
    invalidate(client, adminKeys.all),
    invalidate(client, sessionKeys.lists()),
    invalidate(client, sessionKeys.details(), sessionsOfClass(detail.id)),
    invalidate(client, studentKeys.profiles(), profilesOfClass(detail.id)),
    invalidate(client, attendanceKeys.byClass(detail.id)),
    invalidate(client, billingKeys.lists()),
    invalidate(client, billingKeys.details(), batchesOfClass(detail.id)),
  );
}

/** 默认分组：档案里的「当前小组」随之变化。 */
export async function classGroupingSaved(client: QueryClient, detail: ClassDetail) {
  await put(client, classKeys.detail(detail.id), detail);
  await all(
    invalidate(client, classKeys.lists()),
    invalidate(client, studentKeys.profiles(), profilesOfClass(detail.id)),
  );
}

/** 班级资源：只在班级详情里，读同一详情的观察者自动更新。 */
export async function classNotesSaved(client: QueryClient, detail: ClassDetail) {
  await put(client, classKeys.detail(detail.id), detail);
}

/** 作业模板：SessionDetail 里带着班级模板。 */
export async function homeworkTemplateSaved(client: QueryClient, detail: ClassDetail) {
  await put(client, classKeys.detail(detail.id), detail);
  await invalidate(client, sessionKeys.details(), sessionsOfClass(detail.id));
}

// ---- 学生 -------------------------------------------------------------------

/** 新增学生：已有收费快照不自动建单，所以不碰 billing。 */
export async function studentCreated(client: QueryClient, classId: string) {
  await all(
    invalidate(client, classKeys.detail(classId)),
    invalidate(client, classKeys.lists()),
    invalidate(client, attendanceKeys.byClass(classId)),
    invalidate(client, adminKeys.all),
  );
}

/** 改名：名字嵌在班级名单、档案、历史 recap、考勤、收款单里。 */
export async function studentRenamed(client: QueryClient, student: StudentBasic, classId?: string) {
  const cid = classId ?? classIdOfStudent(client, student.id);
  await all(
    invalidate(client, classDetailKey(cid)),
    invalidate(client, classKeys.lists()),
    invalidate(client, studentKeys.profile(student.id)),
    invalidate(client, sessionKeys.details(), sessionsOfClass(cid)),
    invalidate(client, attendanceKey(cid)),
    invalidate(client, billingKeys.lists()),
    invalidate(client, billingKeys.details(), batchesOfClass(cid)),
  );
}

/** 在读 / 停课 / 归档：服务端会把非在读学生移出默认分组；不自动重算金额。 */
export async function studentStatusChanged(client: QueryClient, student: StudentBasic, classId?: string) {
  const cid = classId ?? classIdOfStudent(client, student.id);
  await all(
    invalidate(client, classDetailKey(cid)),
    invalidate(client, classKeys.lists()),
    invalidate(client, studentKeys.profile(student.id)),
    invalidate(client, attendanceKey(cid)),
    invalidate(client, billingKeys.details(), batchesOfClass(cid)),
    invalidate(client, adminKeys.all),
  );
}

/** 硬删学生：连带上课记录行与收款单。 */
export async function studentDeleted(client: QueryClient, studentId: string, classId?: string) {
  const cid = classId ?? classIdOfStudent(client, studentId);
  client.removeQueries({ queryKey: studentKeys.profile(studentId), exact: true });
  client.removeQueries({ queryKey: billingKeys.invoiceLessonsAll(), predicate: invoiceLessonsOfStudent(studentId) });
  await all(
    invalidate(client, classDetailKey(cid)),
    invalidate(client, classKeys.lists()),
    invalidate(client, sessionKeys.lists()),
    invalidate(client, sessionKeys.details(), sessionsOfClass(cid)),
    invalidate(client, attendanceKey(cid)),
    invalidate(client, billingKeys.lists()),
    invalidate(client, billingKeys.details(), batchesOfClass(cid)),
    invalidate(client, adminKeys.all),
  );
}

// ---- 课堂 -------------------------------------------------------------------

/** 一节课的增删改会波及：课堂列表与同班详情（上节课作业引用）、班级概要、档案、考勤、收费展示与出勤明细、管理员统计。 */
function classSessionsChanged(client: QueryClient, classId: string | undefined, keep?: QueryKey) {
  const sameClass = sessionsOfClass(classId);
  return all(
    invalidate(client, sessionKeys.lists()),
    invalidate(client, sessionKeys.details(), keep ? except(keep, sameClass) : sameClass),
    invalidate(client, classDetailKey(classId)),
    invalidate(client, classKeys.lists()),
    invalidate(client, studentKeys.profiles(), profilesOfClass(classId)),
    invalidate(client, attendanceKey(classId)),
    invalidate(client, billingKeys.lists()),
    invalidate(client, billingKeys.details(), batchesOfClass(classId)),
    invalidate(client, billingKeys.invoiceLessonsAll()),
    invalidate(client, adminKeys.all),
  );
}

/** 结束课堂（含幂等重放）。CommitResult 不是 SessionDetail，详情靠失效后重读。提交可能新增奖章。 */
export async function sessionCommitted(client: QueryClient, classId: string) {
  await all(classSessionsChanged(client, classId), invalidate(client, tagKeys.all));
}

/** 编辑上课记录的整单覆盖，同样可能新增奖章。 */
export async function sessionOverwritten(client: QueryClient, sessionId: string, classId?: string) {
  const cid = classId ?? classIdOfSession(client, sessionId);
  await all(
    invalidate(client, sessionKeys.detail(sessionId)),
    classSessionsChanged(client, cid),
    invalidate(client, tagKeys.all),
  );
}

export async function sessionDeleted(client: QueryClient, sessionId: string, classId?: string) {
  const cid = classId ?? classIdOfSession(client, sessionId);
  client.removeQueries({ queryKey: sessionKeys.detail(sessionId), exact: true });
  await classSessionsChanged(client, cid);
}

/** 课堂信息（课次 / 老师 / 时间）：时间变化影响上节课顺序与收费周期归属。 */
export async function sessionInfoUpdated(client: QueryClient, detail: SessionDetail) {
  await put(client, sessionKeys.detail(detail.id), detail);
  await classSessionsChanged(client, detail.classId, sessionKeys.detail(detail.id));
}

/** 课堂作业：同班其他课的 prevHomework、班级 sessions[].hasHomework、上节课参考。 */
export async function sessionHomeworkUpdated(client: QueryClient, detail: SessionDetail) {
  const key = sessionKeys.detail(detail.id);
  await put(client, key, detail);
  await all(
    invalidate(client, sessionKeys.lists()),
    invalidate(client, sessionKeys.details(), except(key, sessionsOfClass(detail.classId))),
    invalidate(client, classKeys.detail(detail.classId)),
  );
}

// ---- 考勤 -------------------------------------------------------------------

export function upsertAttendanceRecord(data: ClassAttendance, record: AttendanceRecord): ClassAttendance {
  const same = (r: AttendanceRecord) => r.sessionId === record.sessionId && r.studentId === record.studentId;
  const records = data.records.some(same) ? data.records.map((r) => (same(r) ? record : r)) : [...data.records, record];
  return { ...data, records };
}

/**
 * 考勤更正 / 补课：精确回写这一格，不整表重取（其他格可能正 pending）。
 * 若这张表正有请求在途（可能是写入前的快照），重启它以免旧快照覆盖本格。
 * 收费只刷新展示（出勤明细、批次详情），绝不触发重算。
 */
export async function attendanceUpdated(client: QueryClient, record: AttendanceRecord, classId?: string) {
  const cid = classId ?? classIdOfSession(client, record.sessionId);
  const tables = cid
    ? [attendanceKeys.byClass(cid)]
    : client.getQueriesData({ queryKey: attendanceKeys.classes() }).map(([k]) => k);
  const restart: Promise<unknown>[] = [];
  for (const key of tables) {
    if (client.isFetching({ queryKey: key, exact: true }) > 0) {
      restart.push(client.invalidateQueries({ queryKey: key, exact: true }));
    }
    client.setQueryData<ClassAttendance>(key, (old) => old && upsertAttendanceRecord(old, record));
  }
  await all(
    ...restart,
    invalidate(client, sessionKeys.detail(record.sessionId)),
    invalidate(client, sessionKeys.lists()),
    invalidate(client, classDetailKey(cid)),
    invalidate(client, studentKeys.profile(record.studentId)),
    invalidate(client, billingKeys.invoiceLessonsAll(), invoiceLessonsOfStudent(record.studentId)),
    invalidate(client, billingKeys.details(), batchesOfClass(cid)),
  );
}

// ---- 排班 -------------------------------------------------------------------

/** 排班节次变化：该班周期列表、批次的计划/已上节数、出勤明细、管理员统计。 */
function scheduleChanged(client: QueryClient, classId: string | undefined) {
  return all(
    invalidate(client, scheduleListKey(classId)),
    invalidate(client, billingKeys.lists()),
    invalidate(client, billingKeys.details(), batchesOfClass(classId)),
    invalidate(client, billingKeys.invoiceLessonsAll()),
    invalidate(client, adminKeys.all),
  );
}

export async function scheduleSaved(client: QueryClient, detail: ScheduleDetail, classId?: string) {
  const cid = classId ?? classIdOfSchedule(client, detail.id);
  await put(client, scheduleKeys.detail(detail.id), detail);
  await scheduleChanged(client, cid);
}

export async function scheduleDeleted(client: QueryClient, scheduleId: string, classId?: string) {
  const cid = classId ?? classIdOfSchedule(client, scheduleId);
  client.removeQueries({ queryKey: scheduleKeys.detail(scheduleId), exact: true });
  await scheduleChanged(client, cid);
}

// ---- 收费 -------------------------------------------------------------------

/** 新建批次：周期被占用（schedule.batchId）。 */
export async function billingBatchCreated(client: QueryClient, detail: BillingBatchDetail) {
  await put(client, billingKeys.detail(detail.id), detail);
  await all(
    invalidate(client, billingKeys.lists()),
    invalidate(client, scheduleKeys.list(detail.classId)),
    invalidate(client, scheduleKeys.detail(detail.scheduleId)),
    invalidate(client, adminKeys.all),
  );
}

export async function billingBatchRecalculated(client: QueryClient, detail: BillingBatchDetail) {
  await put(client, billingKeys.detail(detail.id), detail);
  const invoiceIds = new Set(detail.invoices.map((i) => i.id));
  await all(
    invalidate(client, billingKeys.lists()),
    invalidate(client, billingKeys.invoiceLessonsAll(), (q) => invoiceIds.has(q.queryKey[2] as string)),
    invalidate(client, adminKeys.all),
  );
}

/** 删除批次：收款单随之删除，周期解除占用。归属从删除前的缓存采集。 */
export async function billingBatchDeleted(client: QueryClient, batchId: string) {
  const detail = client.getQueryData<BillingBatchDetail>(billingKeys.detail(batchId));
  const item = detail ?? client.getQueryData<BillingBatchItem[]>(billingKeys.lists())?.find((b) => b.id === batchId);
  client.removeQueries({ queryKey: billingKeys.detail(batchId), exact: true });
  const invoiceIds = detail ? new Set(detail.invoices.map((i) => i.id)) : undefined;
  client.removeQueries({
    queryKey: billingKeys.invoiceLessonsAll(),
    predicate: (q) => !invoiceIds || invoiceIds.has(q.queryKey[2] as string),
  });
  await all(
    invalidate(client, billingKeys.lists()),
    invalidate(client, scheduleListKey(item?.classId)),
    invalidate(client, item ? scheduleKeys.detail(item.scheduleId) : scheduleKeys.details()),
    invalidate(client, adminKeys.all),
  );
}

/**
 * 改费用 / 确认 / 撤销收款：响应只有这一行。先替换已缓存批次里的对应行（即时反馈），
 * 汇总金额不手工推算，靠失效后重读。
 */
export async function invoiceChanged(client: QueryClient, invoice: InvoiceItem, batchId?: string) {
  const contains = (d: BillingBatchDetail | undefined) => d?.invoices.some((i) => i.id === invoice.id) ?? false;
  const holders = client
    .getQueriesData<BillingBatchDetail>({ queryKey: billingKeys.details() })
    .filter(([key, d]) => (batchId ? key[2] === batchId : contains(d)));
  for (const [key] of holders) {
    client.setQueryData<BillingBatchDetail>(
      key,
      (old) => old && { ...old, invoices: old.invoices.map((i) => (i.id === invoice.id ? invoice : i)) },
    );
  }
  const detailKey = batchId ? billingKeys.detail(batchId) : billingKeys.details();
  await all(
    invalidate(client, detailKey, batchId ? undefined : (q) => q.state.data === undefined || contains(dataOf(q))),
    invalidate(client, billingKeys.lists()),
    invalidate(client, adminKeys.all),
  );
}

// ---- 老师 / 管理员 ----------------------------------------------------------

/**
 * 老师改名：老师名出现在当前用户、班级、课堂、收款人、管理员列表。
 * 列表与本人 me 先就地替换名字（即时反馈），再失效重读（同时作废写入前发出的在途读取）。
 */
export async function teacherUpdated(client: QueryClient, teacher: TeacherItem) {
  client.setQueryData<TeacherItem[]>(teacherKeys.lists(), (old) =>
    old?.map((t) => (t.id === teacher.id ? teacher : t)),
  );
  const self = client.getQueryData<Me | null>(authKeys.me())?.id === teacher.id;
  if (self) client.setQueryData<Me>(authKeys.me(), (me) => me && { ...me, name: teacher.name });
  await all(
    self ? invalidate(client, authKeys.me()) : Promise.resolve(),
    invalidate(client, teacherKeys.all),
    invalidate(client, classKeys.all),
    invalidate(client, sessionKeys.all),
    invalidate(client, billingKeys.details()),
    invalidate(client, adminKeys.all),
  );
}

/** 管理员添加老师：只影响老师列表，不改任何现有用户权限。 */
export async function teacherCreated(client: QueryClient) {
  await invalidate(client, teacherKeys.all);
}

/**
 * 管理员删除班级（硬删全部关联数据）：清除能判定属于该班的缓存；排班详情、出勤明细
 * 缓存里没有班级归属，整域清除。其余列表与统计失效。
 */
export async function adminClassDeleted(client: QueryClient, classId: string) {
  client.removeQueries({ queryKey: classKeys.detail(classId), exact: true });
  client.removeQueries({ queryKey: attendanceKeys.byClass(classId), exact: true });
  client.removeQueries({ queryKey: scheduleKeys.list(classId), exact: true });
  client.removeQueries({ queryKey: inviteKeys.requests(classId), exact: true });
  client.removeQueries({ queryKey: sessionKeys.details(), predicate: sessionsOfClass(classId) });
  client.removeQueries({ queryKey: studentKeys.profiles(), predicate: profilesOfClass(classId) });
  client.removeQueries({ queryKey: billingKeys.details(), predicate: batchesOfClass(classId) });
  client.removeQueries({ queryKey: scheduleKeys.details() });
  client.removeQueries({ queryKey: billingKeys.invoiceLessonsAll() });
  await all(
    invalidate(client, classKeys.lists()),
    invalidate(client, sessionKeys.lists()),
    invalidate(client, billingKeys.lists()),
    invalidate(client, adminKeys.all),
  );
}

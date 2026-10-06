// Query key factories，按领域命名。组件与 cache-effects 只通过这里拿 key，不手拼数组。
// 约定：`all` 是领域前缀；`lists()` / `details()` 是可整体失效的子前缀；带 ID 的是精确 key。
// 目前所有列表筛选（归档、收银台 all/pending/settled）都是客户端派生，不进 key。

export const authKeys = {
  all: ['auth'] as const,
  me: () => ['auth', 'me'] as const,
};

export const teacherKeys = {
  all: ['teachers'] as const,
  lists: () => ['teachers', 'list'] as const,
};

export const tagKeys = {
  all: ['tags'] as const,
  lists: () => ['tags', 'list'] as const,
};

export const adminKeys = {
  all: ['admin'] as const,
  classes: () => ['admin', 'classes'] as const,
};

export const classKeys = {
  all: ['classes'] as const,
  lists: () => ['classes', 'list'] as const,
  details: () => ['classes', 'detail'] as const,
  detail: (classId: string) => ['classes', 'detail', classId] as const,
};

export const studentKeys = {
  all: ['students'] as const,
  profiles: () => ['students', 'profile'] as const,
  profile: (studentId: string) => ['students', 'profile', studentId] as const,
};

export const sessionKeys = {
  all: ['sessions'] as const,
  lists: () => ['sessions', 'list'] as const,
  details: () => ['sessions', 'detail'] as const,
  detail: (sessionId: string) => ['sessions', 'detail', sessionId] as const,
};

export const attendanceKeys = {
  all: ['attendance'] as const,
  classes: () => ['attendance', 'class'] as const,
  byClass: (classId: string) => ['attendance', 'class', classId] as const,
  /** Mutation key：考勤格 pending overlay 与按格防重复提交据此筛选。 */
  update: () => ['attendance', 'update'] as const,
};

export const inviteKeys = {
  all: ['invites'] as const,
  requests: (classId: string) => ['invites', 'requests', classId] as const,
};

export const scheduleKeys = {
  all: ['schedules'] as const,
  lists: () => ['schedules', 'list'] as const,
  list: (classId: string) => ['schedules', 'list', classId] as const,
  details: () => ['schedules', 'detail'] as const,
  detail: (scheduleId: string) => ['schedules', 'detail', scheduleId] as const,
};

export const billingKeys = {
  all: ['billing'] as const,
  lists: () => ['billing', 'list'] as const,
  details: () => ['billing', 'detail'] as const,
  detail: (batchId: string) => ['billing', 'detail', batchId] as const,
  invoiceLessonsAll: () => ['billing', 'invoice-lessons'] as const,
  invoiceLessons: (invoiceId: string) => ['billing', 'invoice-lessons', invoiceId] as const,
};

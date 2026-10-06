import { describe, expect, it } from 'vitest';
import * as admin from './admin';
import * as attendance from './attendance';
import * as auth from './auth';
import * as billing from './billing';
import * as classes from './classes';
import * as invites from './invites';
import * as schedules from './schedules';
import * as sessions from './sessions';
import * as students from './students';
import * as tags from './tags';
import * as teachers from './teachers';

// Plan 1 验收清点：原 lib/api 的 47 个方法（Plan 2 已删除该兼容桥）各有一个领域 hook，16 个读取各有可复用的 queryOptions。

const modules = { admin, attendance, auth, billing, classes, invites, schedules, sessions, students, tags, teachers };

const hooks = [
  'useMeQuery',
  'useLoginMutation',
  'useLogoutMutation',
  'useVerifyPasswordMutation',
  'useTeachersQuery',
  'useUpdateTeacherMutation',
  'useTagsQuery',
  'useAdminClassesQuery',
  'useCreateAdminTeacherMutation',
  'useDeleteAdminClassMutation',
  'useResetAdminTeacherPasswordMutation',
  'useClassesQuery',
  'useClassQuery',
  'useCreateClassMutation',
  'useUpdateClassMutation',
  'useSaveClassGroupingMutation',
  'useUpdateClassNotesMutation',
  'useUpdateHomeworkTemplateMutation',
  'useCreateStudentMutation',
  'useUpdateStudentMutation',
  'useDeleteStudentMutation',
  'useUpdateStudentStatusMutation',
  'useStudentProfileQuery',
  'useSessionsQuery',
  'useSessionQuery',
  'useDeleteSessionMutation',
  'useUpdateSessionMutation',
  'useUpdateSessionHomeworkMutation',
  'useCommitSessionMutation',
  'useOverwriteSessionMutation',
  'useClassAttendanceQuery',
  'useUpdateAttendanceMutation',
  'useJoinRequestsQuery',
  'useSchedulesQuery',
  'useScheduleQuery',
  'useCreateScheduleMutation',
  'useUpdateScheduleMutation',
  'useDeleteScheduleMutation',
  'useBillingBatchesQuery',
  'useBillingBatchQuery',
  'useCreateBillingBatchMutation',
  'useRecalculateBillingBatchMutation',
  'useDeleteBillingBatchMutation',
  'useUpdateInvoiceMutation',
  'useConfirmInvoiceMutation',
  'useUnconfirmInvoiceMutation',
  'useInvoiceLessonsQuery',
];

const exported = Object.values(modules).flatMap((m) => Object.keys(m));

describe('query layer inventory', () => {
  it('has one hook per old api method (47)', () => {
    expect(new Set(hooks).size).toBe(47);
    for (const name of hooks) expect(exported, name).toContain(name);
  });

  it('has reusable queryOptions for all 16 reads', () => {
    const options = exported.filter((k) => k.endsWith('QueryOptions'));
    expect(options.sort()).toEqual(
      [
        'meQueryOptions',
        'teachersQueryOptions',
        'tagsQueryOptions',
        'adminClassesQueryOptions',
        'classesQueryOptions',
        'classQueryOptions',
        'studentProfileQueryOptions',
        'sessionsQueryOptions',
        'sessionQueryOptions',
        'classAttendanceQueryOptions',
        'joinRequestsQueryOptions',
        'schedulesQueryOptions',
        'scheduleQueryOptions',
        'billingBatchesQueryOptions',
        'billingBatchQueryOptions',
        'invoiceLessonsQueryOptions',
      ].sort(),
    );
  });
});

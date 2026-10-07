import { queryOptions, useMutationState, useQuery, type QueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import {
  getClassAttendance,
  updateAttendance,
  type AttendanceInput,
  type AttendanceRecord,
  type ClassAttendance,
} from '../api/attendance';
import { recordKey } from '../lib/attendance';
import { attendanceUpdated, upsertAttendanceRecord } from './cache-effects';
import { enabledWith, type QueryHookOptions } from './client';
import { attendanceKeys } from './keys';
import { useAppMutation } from './mutation';

// 考勤表即时反馈：缓存里只放服务端确认过的记录；进行中的修改以 pending overlay 叠加在读取结果上。
// - 失败：overlay 随 Mutation 结束消失，只有这一格回到服务端值，其他格不受影响；
// - 整表重取：只替换底层快照，pending 格仍显示本次修改；
// - 同一格（sessionId + studentId）有未完成写入时拒绝再次提交，其他格可并行。

export interface AttendanceUpdateVariables {
  classId: string;
  sessionId: string;
  studentId: string;
  input: AttendanceInput;
}

/** 与服务端口径一致：补课只对未到堂有效，改回 present 即清除。 */
export const pendingRecordOf = (v: AttendanceUpdateVariables): AttendanceRecord => ({
  sessionId: v.sessionId,
  studentId: v.studentId,
  status: v.input.status,
  madeUp: v.input.status !== 'present' && v.input.madeUp === true,
});

export class AttendanceCellBusyError extends Error {
  constructor() {
    super('这一格正在保存，请稍候');
    this.name = 'AttendanceCellBusyError';
  }
}

const busyCells = new WeakMap<QueryClient, Set<string>>();

function busyCellsOf(client: QueryClient): Set<string> {
  const existing = busyCells.get(client);
  if (existing) return existing;
  const created = new Set<string>();
  busyCells.set(client, created);
  return created;
}

/** 本班已占用格子（onMutate 通过）的进行中修改，按提交顺序。 */
function usePendingAttendanceUpdates(classId: string | undefined): AttendanceUpdateVariables[] {
  return useMutationState({
    filters: {
      mutationKey: attendanceKeys.update(),
      status: 'pending',
      predicate: (m) =>
        m.state.context !== undefined && (m.state.variables as AttendanceUpdateVariables).classId === classId,
    },
    select: (m) => m.state.variables as AttendanceUpdateVariables,
  });
}

/** 撤销 / 再次点击要据此禁用对应格。key 为 lib/attendance 的 recordKey。 */
export function usePendingAttendanceCells(classId: string | undefined): ReadonlySet<string> {
  const pending = usePendingAttendanceUpdates(classId);
  return useMemo(() => new Set(pending.map((v) => recordKey(v.sessionId, v.studentId))), [pending]);
}

export const classAttendanceQueryOptions = (classId: string) =>
  queryOptions({
    queryKey: attendanceKeys.byClass(classId),
    queryFn: ({ signal }) => getClassAttendance(classId, { signal }),
  });

export function useClassAttendanceQuery(classId: string | undefined, options?: QueryHookOptions) {
  const pending = usePendingAttendanceUpdates(classId);
  const select = useCallback(
    (data: ClassAttendance) => pending.reduce((d, v) => upsertAttendanceRecord(d, pendingRecordOf(v)), data),
    [pending],
  );
  return useQuery({ ...classAttendanceQueryOptions(classId ?? ''), enabled: enabledWith(classId, options), select });
}

export function useUpdateAttendanceMutation() {
  return useAppMutation({
    mutationKey: attendanceKeys.update(),
    onMutate: (client, v: AttendanceUpdateVariables) => {
      const cell = recordKey(v.sessionId, v.studentId);
      const busy = busyCellsOf(client);
      if (busy.has(cell)) throw new AttendanceCellBusyError();
      busy.add(cell);
      return cell;
    },
    mutationFn: (v: AttendanceUpdateVariables) => updateAttendance(v.sessionId, v.studentId, v.input),
    onSuccess: (client, record, v) => attendanceUpdated(client, record, v.classId),
    onSettled: (client, _v, cell) => {
      if (cell) busyCellsOf(client).delete(cell);
    },
  });
}

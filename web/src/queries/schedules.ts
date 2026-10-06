import { queryOptions, useQuery } from '@tanstack/react-query';
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listSchedules,
  updateSchedule,
  type ScheduleLessonInput,
} from '../api/schedules';
import { scheduleDeleted, scheduleSaved } from './cache-effects';
import { enabledWith, type QueryHookOptions } from './client';
import { scheduleKeys } from './keys';
import { useAppMutation } from './mutation';

export const schedulesQueryOptions = (classId: string) =>
  queryOptions({
    queryKey: scheduleKeys.list(classId),
    queryFn: ({ signal }) => listSchedules(classId, { signal }),
  });

export const useSchedulesQuery = (classId: string | undefined, options?: QueryHookOptions) =>
  useQuery({ ...schedulesQueryOptions(classId ?? ''), enabled: enabledWith(classId, options) });

export const scheduleQueryOptions = (scheduleId: string) =>
  queryOptions({
    queryKey: scheduleKeys.detail(scheduleId),
    queryFn: ({ signal }) => getSchedule(scheduleId, { signal }),
  });

/** 打开编辑周期时才传 scheduleId。 */
export const useScheduleQuery = (scheduleId: string | undefined, options?: QueryHookOptions) =>
  useQuery({ ...scheduleQueryOptions(scheduleId ?? ''), enabled: enabledWith(scheduleId, options) });

type ScheduleInput = { name: string; lessons: ScheduleLessonInput[] };

export function useCreateScheduleMutation() {
  return useAppMutation({
    mutationFn: ({ classId, input }: { classId: string; input: ScheduleInput }) => createSchedule(classId, input),
    onSuccess: (client, detail, { classId }) => scheduleSaved(client, detail, classId),
  });
}

export function useUpdateScheduleMutation() {
  return useAppMutation({
    mutationFn: ({ scheduleId, input }: { scheduleId: string; classId?: string; input: Partial<ScheduleInput> }) =>
      updateSchedule(scheduleId, input),
    onSuccess: (client, detail, { classId }) => scheduleSaved(client, detail, classId),
  });
}

export function useDeleteScheduleMutation() {
  return useAppMutation({
    mutationFn: ({ scheduleId }: { scheduleId: string; classId?: string }) => deleteSchedule(scheduleId),
    onSuccess: (client, _data, { scheduleId, classId }) => scheduleDeleted(client, scheduleId, classId),
  });
}

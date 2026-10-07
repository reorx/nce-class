import { queryOptions, useQuery } from '@tanstack/react-query';
import { listTeachers, updateTeacher } from '../api/teachers';
import { teacherUpdated } from './cache-effects';
import { LONG_STALE_TIME, type QueryHookOptions } from './client';
import { teacherKeys } from './keys';
import { useAppMutation } from './mutation';

export const teachersQueryOptions = () =>
  queryOptions({
    queryKey: teacherKeys.lists(),
    queryFn: ({ signal }) => listTeachers({ signal }),
    staleTime: LONG_STALE_TIME,
  });

export const useTeachersQuery = (options?: QueryHookOptions) =>
  useQuery({ ...teachersQueryOptions(), enabled: options?.enabled });

export function useUpdateTeacherMutation() {
  return useAppMutation({
    mutationFn: ({ teacherId, input }: { teacherId: string; input: { name: string } }) =>
      updateTeacher(teacherId, input),
    onSuccess: (client, teacher) => teacherUpdated(client, teacher),
  });
}

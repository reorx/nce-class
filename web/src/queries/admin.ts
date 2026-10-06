import { queryOptions, useQuery } from '@tanstack/react-query';
import {
  createAdminTeacher,
  deleteAdminClass,
  listAdminClasses,
  resetAdminTeacherPassword,
  type CreateTeacherInput,
} from '../api/admin';
import { adminClassDeleted, teacherCreated } from './cache-effects';
import type { QueryHookOptions } from './client';
import { adminKeys } from './keys';
import { useSensitiveMutation } from './mutation';

// 管理员：调用方按 me.isAdmin 传 enabled；非管理员不发请求。三个写操作都带密码，完成即清理状态。

export const adminClassesQueryOptions = () =>
  queryOptions({
    queryKey: adminKeys.classes(),
    queryFn: ({ signal }) => listAdminClasses({ signal }),
  });

export const useAdminClassesQuery = (options?: QueryHookOptions) =>
  useQuery({ ...adminClassesQueryOptions(), enabled: options?.enabled });

export function useCreateAdminTeacherMutation() {
  return useSensitiveMutation({
    mutationFn: (input: CreateTeacherInput) => createAdminTeacher(input),
    onSuccess: (client) => teacherCreated(client),
  });
}

export function useDeleteAdminClassMutation() {
  return useSensitiveMutation({
    mutationFn: ({ classId, adminPassword }: { classId: string; adminPassword: string }) =>
      deleteAdminClass(classId, adminPassword),
    onSuccess: (client, _data, { classId }) => adminClassDeleted(client, classId),
  });
}

/** 改密不伪造任何数据更新，也不假设服务端注销该老师已有会话。 */
export function useResetAdminTeacherPasswordMutation() {
  return useSensitiveMutation({
    mutationFn: ({ teacherId, password, adminPassword }: { teacherId: string; password: string; adminPassword: string }) =>
      resetAdminTeacherPassword(teacherId, password, adminPassword),
  });
}

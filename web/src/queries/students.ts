import { queryOptions, useQuery } from '@tanstack/react-query';
import {
  createStudent,
  deleteStudent,
  getStudentProfile,
  updateStudent,
  updateStudentStatus,
  type StudentInput,
  type StudentStatus,
} from '../api/students';
import { studentCreated, studentDeleted, studentRenamed, studentStatusChanged } from './cache-effects';
import { enabledWith, type QueryHookOptions } from './client';
import { studentKeys } from './keys';
import { useAppMutation } from './mutation';

// 写接口响应是 StudentBasic（不含 score / groupId），不冒充班级详情里的 Student，相关缓存一律失效重读。
// variables 里的 classId 只用于收窄失效范围，不发给后端；不传则从缓存推断，推断不出就按领域前缀失效。

export const studentProfileQueryOptions = (studentId: string) =>
  queryOptions({
    queryKey: studentKeys.profile(studentId),
    queryFn: ({ signal }) => getStudentProfile(studentId, { signal }),
  });

export const useStudentProfileQuery = (studentId: string | undefined, options?: QueryHookOptions) =>
  useQuery({ ...studentProfileQueryOptions(studentId ?? ''), enabled: enabledWith(studentId, options) });

export function useCreateStudentMutation() {
  return useAppMutation({
    mutationFn: ({ classId, input }: { classId: string; input: StudentInput }) => createStudent(classId, input),
    onSuccess: (client, _student, { classId }) => studentCreated(client, classId),
  });
}

/** input.cnName 缺省 = 保持原中文名，空串才清空（照原样发给后端）。 */
export function useUpdateStudentMutation() {
  return useAppMutation({
    mutationFn: ({ studentId, input }: { studentId: string; input: StudentInput; classId?: string }) =>
      updateStudent(studentId, input),
    onSuccess: (client, student, { classId }) => studentRenamed(client, student, classId),
  });
}

export function useUpdateStudentStatusMutation() {
  return useAppMutation({
    mutationFn: ({ studentId, status }: { studentId: string; status: StudentStatus; classId?: string }) =>
      updateStudentStatus(studentId, status),
    onSuccess: (client, student, { classId }) => studentStatusChanged(client, student, classId),
  });
}

export function useDeleteStudentMutation() {
  return useAppMutation({
    mutationFn: ({ studentId }: { studentId: string; classId?: string }) => deleteStudent(studentId),
    onSuccess: (client, _data, { studentId, classId }) => studentDeleted(client, studentId, classId),
  });
}

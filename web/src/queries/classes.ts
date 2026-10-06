import { queryOptions, useQuery } from '@tanstack/react-query';
import {
  createClass,
  getClass,
  listClasses,
  saveClassGrouping,
  updateClass,
  updateClassNotes,
  updateHomeworkTemplate,
  type CreateClassInput,
  type GroupSave,
  type UpdateClassInput,
} from '../api/classes';
import {
  classCreated,
  classGroupingSaved,
  classInfoUpdated,
  classNotesSaved,
  homeworkTemplateSaved,
} from './cache-effects';
import { enabledWith, type QueryHookOptions } from './client';
import { classKeys } from './keys';
import { useAppMutation } from './mutation';

export const classesQueryOptions = () =>
  queryOptions({
    queryKey: classKeys.lists(),
    queryFn: ({ signal }) => listClasses({ signal }),
  });

/** 归档筛选是客户端派生（lib/classList），不拆成多个缓存。 */
export const useClassesQuery = (options?: QueryHookOptions) =>
  useQuery({ ...classesQueryOptions(), enabled: options?.enabled });

export const classQueryOptions = (classId: string) =>
  queryOptions({
    queryKey: classKeys.detail(classId),
    queryFn: ({ signal }) => getClass(classId, { signal }),
  });

export const useClassQuery = (classId: string | undefined, options?: QueryHookOptions) =>
  useQuery({ ...classQueryOptions(classId ?? ''), enabled: enabledWith(classId, options) });

/**
 * 用班级详情初始化草稿（课前配置的名单与分组、URL 直接开课、编辑上课记录的默认分组）时用：
 * 挂载时即便缓存新鲜也重读一次，调用方等 isFetchedAfterMount 再使用，不把旧名单固化进新课堂。
 */
export const useLatestClassQuery = (classId: string | undefined, options?: QueryHookOptions) =>
  useQuery({ ...classQueryOptions(classId ?? ''), enabled: enabledWith(classId, options), refetchOnMount: 'always' });

// 以下写接口都返回完整 ClassDetail，直接写入详情缓存。

export function useCreateClassMutation() {
  return useAppMutation({
    mutationFn: (input: CreateClassInput) => createClass(input),
    onSuccess: (client, detail) => classCreated(client, detail),
  });
}

export function useUpdateClassMutation() {
  return useAppMutation({
    mutationFn: ({ classId, input }: { classId: string; input: UpdateClassInput }) => updateClass(classId, input),
    onSuccess: (client, detail) => classInfoUpdated(client, detail),
  });
}

export function useSaveClassGroupingMutation() {
  return useAppMutation({
    mutationFn: ({ classId, groups }: { classId: string; groups: GroupSave[] }) => saveClassGrouping(classId, groups),
    onSuccess: (client, detail) => classGroupingSaved(client, detail),
  });
}

export function useUpdateClassNotesMutation() {
  return useAppMutation({
    mutationFn: ({ classId, notes }: { classId: string; notes: string }) => updateClassNotes(classId, notes),
    onSuccess: (client, detail) => classNotesSaved(client, detail),
  });
}

export function useUpdateHomeworkTemplateMutation() {
  return useAppMutation({
    mutationFn: ({ classId, template }: { classId: string; template: string }) =>
      updateHomeworkTemplate(classId, template),
    onSuccess: (client, detail) => homeworkTemplateSaved(client, detail),
  });
}

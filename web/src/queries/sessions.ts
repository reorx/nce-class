import { queryOptions, useQuery } from '@tanstack/react-query';
import {
  commitSession,
  deleteSession,
  getSession,
  listSessions,
  overwriteSession,
  updateSession,
  updateSessionHomework,
  type CommitPayload,
  type SessionHomeworkInput,
  type UpdateSessionInput,
} from '../api/sessions';
import {
  sessionCommitted,
  sessionDeleted,
  sessionHomeworkUpdated,
  sessionInfoUpdated,
  sessionOverwritten,
} from './cache-effects';
import { enabledWith, type QueryHookOptions } from './client';
import { sessionKeys } from './keys';
import { useAppMutation } from './mutation';

export const sessionsQueryOptions = () =>
  queryOptions({
    queryKey: sessionKeys.lists(),
    queryFn: ({ signal }) => listSessions({ signal }),
  });

export const useSessionsQuery = (options?: QueryHookOptions) =>
  useQuery({ ...sessionsQueryOptions(), enabled: options?.enabled });

export const sessionQueryOptions = (sessionId: string) =>
  queryOptions({
    queryKey: sessionKeys.detail(sessionId),
    queryFn: ({ signal }) => getSession(sessionId, { signal }),
  });

export const useSessionQuery = (sessionId: string | undefined, options?: QueryHookOptions) =>
  useQuery({ ...sessionQueryOptions(sessionId ?? ''), enabled: enabledWith(sessionId, options) });

/** 编辑上课记录建立本地底稿时用：挂载时总会重读最新记录，调用方等 isFetchedAfterMount 再使用。 */
export const useLatestSessionQuery = (sessionId: string | undefined, options?: QueryHookOptions) =>
  useQuery({
    ...sessionQueryOptions(sessionId ?? ''),
    enabled: enabledWith(sessionId, options),
    refetchOnMount: 'always',
  });

export function useDeleteSessionMutation() {
  return useAppMutation({
    mutationFn: ({ sessionId }: { sessionId: string; classId?: string }) => deleteSession(sessionId),
    onSuccess: (client, _data, { sessionId, classId }) => sessionDeleted(client, sessionId, classId),
  });
}

/** 部分更新课堂信息；响应是完整 SessionDetail。 */
export function useUpdateSessionMutation() {
  return useAppMutation({
    mutationFn: ({ sessionId, input }: { sessionId: string; input: UpdateSessionInput }) =>
      updateSession(sessionId, input),
    onSuccess: (client, detail) => sessionInfoUpdated(client, detail),
  });
}

export function useUpdateSessionHomeworkMutation() {
  return useAppMutation({
    mutationFn: ({ sessionId, input }: { sessionId: string; input: SessionHomeworkInput }) =>
      updateSessionHomework(sessionId, input),
    onSuccess: (client, detail) => sessionHomeworkUpdated(client, detail),
  });
}

/**
 * 结束课堂。payload 原样发送（schema 向后兼容，调用方负责冻结与备份）；
 * 成功后的刷新失败不会让提交变成失败。CommitResult 不是 SessionDetail，不写入详情缓存。
 */
export function useCommitSessionMutation() {
  return useAppMutation({
    mutationFn: ({ classId, payload }: { classId: string; payload: CommitPayload }) => commitSession(classId, payload),
    onSuccess: (client, _result, { classId }) => sessionCommitted(client, classId),
  });
}

/** 编辑上课记录：整单覆盖已有课堂。classId 只用于失效，不发给后端。 */
export function useOverwriteSessionMutation() {
  return useAppMutation({
    mutationFn: ({ sessionId, payload }: { sessionId: string; classId: string; payload: CommitPayload }) =>
      overwriteSession(sessionId, payload),
    onSuccess: (client, _result, { sessionId, classId }) => sessionOverwritten(client, sessionId, classId),
  });
}

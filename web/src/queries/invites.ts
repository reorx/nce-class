import { queryOptions, useQuery } from '@tanstack/react-query';
import { listJoinRequests } from '../api/invites';
import { enabledWith, type QueryHookOptions } from './client';
import { inviteKeys } from './keys';

export const joinRequestsQueryOptions = (classId: string) =>
  queryOptions({
    queryKey: inviteKeys.requests(classId),
    queryFn: ({ signal }) => listJoinRequests(classId, { signal }),
  });

export const useJoinRequestsQuery = (classId: string | undefined, options?: QueryHookOptions) =>
  useQuery({ ...joinRequestsQueryOptions(classId ?? ''), enabled: enabledWith(classId, options) });

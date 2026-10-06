import { queryOptions, useQuery } from '@tanstack/react-query';
import { listTags } from '../api/tags';
import { LONG_STALE_TIME, type QueryHookOptions } from './client';
import { tagKeys } from './keys';

/** 奖章库：课堂里的下拉数据源。读取失败不阻断本地课堂（调用方按无奖章处理）。 */
export const tagsQueryOptions = () =>
  queryOptions({
    queryKey: tagKeys.lists(),
    queryFn: ({ signal }) => listTags({ signal }),
    staleTime: LONG_STALE_TIME,
  });

export const useTagsQuery = (options?: QueryHookOptions) => useQuery({ ...tagsQueryOptions(), enabled: options?.enabled });

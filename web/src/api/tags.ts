import { get, type RequestOptions } from './client';

/** One org-library 奖章 tag (GET /api/tags). 写入只走结束课堂 commit 的 upsert。 */
export interface TagItem {
  id: string;
  name: string;
}

export const listTags = (options?: RequestOptions) => get<TagItem[]>('/api/tags', options);

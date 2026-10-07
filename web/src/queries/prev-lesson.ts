import { useMemo } from 'react';
import type { Recap } from '../api/sessions';
import {
  prevLessonGroups,
  prevLessonInfo,
  prevLessonStars,
  type PrevLessonGroup,
  type PrevLessonInfo,
  type PrevLessonStar,
} from '../lib/prevLesson';
import { useClassQuery } from './classes';
import { useSessionQuery } from './sessions';

// 「上节课」= 班级详情里最近一节已结束课（classDetail.sessions 倒序首条）+ 该节的 SessionDetail。
// 直接复用班级与 session 两个查询的缓存，不另存一份；班级读到之前不发 session 请求，
// 没有上一节就不请求（不会出现空 ID 路径）。

export interface PrevLesson {
  info: PrevLessonInfo;
  homework: string | null;
  groups: PrevLessonGroup[];
  stars: PrevLessonStar[];
}

export type PrevLessonQueryResult = {
  isFetching: boolean;
  /** 只重取失败的那一段。 */
  refetch: () => void;
} & (
  | { status: 'pending'; data: undefined; error: null }
  | { status: 'error'; data: undefined; error: Error }
  /** data === null：本班还没有上课记录。 */
  | { status: 'success'; data: PrevLesson | null; error: null }
);

function prevLessonOf(info: PrevLessonInfo, homeworkContent: string | null, recap: Recap): PrevLesson {
  return {
    info,
    homework: info.hasHomework ? homeworkContent : null,
    groups: prevLessonGroups(recap),
    stars: prevLessonStars(recap),
  };
}

export function usePrevLessonQuery(classId: string | undefined): PrevLessonQueryResult {
  const classQuery = useClassQuery(classId);
  const info = useMemo(() => (classQuery.data ? prevLessonInfo(classQuery.data.sessions) : undefined), [classQuery.data]);
  const sessionQuery = useSessionQuery(info?.sessionId);
  const detail = sessionQuery.data;
  const data = useMemo(
    () => (info && detail ? prevLessonOf(info, detail.homeworkContent, detail.recap) : undefined),
    [info, detail],
  );

  const isFetching = classQuery.isFetching || sessionQuery.isFetching;
  const refetch = () => {
    if (classQuery.isError) void classQuery.refetch();
    if (sessionQuery.isError) void sessionQuery.refetch();
  };

  if (info === null) return { status: 'success', data: null, error: null, isFetching, refetch };
  if (data) return { status: 'success', data, error: null, isFetching, refetch };
  const error = info === undefined ? classQuery.error : sessionQuery.error;
  if (error) return { status: 'error', data: undefined, error, isFetching, refetch };
  return { status: 'pending', data: undefined, error: null, isFetching, refetch };
}

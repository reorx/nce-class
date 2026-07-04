import type { Session } from './api';
import { lessonLabel } from './lesson';

/** 课堂「上节课」popover 的展示模型；作业内容按需另取（api.sessionDetail）。 */
export interface PrevLessonInfo {
  sessionId: string;
  dateLabel: string; // '7月1日 周二'
  lessonText: string; // '第7课 · Too late'
  hasHomework: boolean;
}

/** classDetail.sessions 服务端按日期倒序且全部 ended，首条即上节课。 */
export function prevLessonInfo(sessions: Session[]): PrevLessonInfo | null {
  const s = sessions[0];
  if (!s) return null;
  return {
    sessionId: s.id,
    dateLabel: `${s.date} ${s.weekday}`,
    lessonText: lessonLabel(s.lessonNumber, s.lessonTitle, '未填写课次'),
    hasHomework: s.hasHomework,
  };
}

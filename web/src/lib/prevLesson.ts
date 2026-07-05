import type { Recap, Session } from './api';
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

/** 每组分数展示模型（按分数降序，同分保持原分组次序）。 */
export interface PrevLessonGroup {
  name: string;
  emoji: string | null;
  score: number;
}

export function prevLessonGroups(recap: Recap): PrevLessonGroup[] {
  return [...recap.groups]
    .sort((a, b) => b.score - a.score || a.orderIndex - b.orderIndex)
    .map((g) => ({ name: g.name, emoji: g.emoji, score: g.score }));
}

/** 今日之星：净得分最高前三（口径同 RecapCard，只含 recap.stars 亮眼学生 net≥2）。 */
export interface PrevLessonStar {
  name: string;
  net: number;
}

export function prevLessonStars(recap: Recap): PrevLessonStar[] {
  return [...recap.stars]
    .sort((a, b) => b.net - a.net)
    .slice(0, 3)
    .map((s) => ({ name: s.name, net: s.net }));
}

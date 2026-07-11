import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import {
  prevLessonGroups,
  prevLessonInfo,
  prevLessonStars,
  type PrevLessonGroup,
  type PrevLessonInfo,
  type PrevLessonStar,
} from '../lib/prevLesson';

// 「上节课」内容体：日期/课次/分数/之星/作业 + 查看上课记录。课堂右上角
// popover 与课前配置页的「上节课回顾」卡共用。数据在服务端（不在离线课堂
// 快照里），挂载时自取：classDetail 定位上节课，sessionDetail 一并带回
// 作业文本与 recap（每组分数/今日之星）。
export type PrevLessonState =
  | { status: 'loading' | 'error' }
  | {
      status: 'ready';
      info: PrevLessonInfo | null;
      homework: string | null;
      groups: PrevLessonGroup[];
      stars: PrevLessonStar[];
    };

/** 取「上节课」数据（严格紧邻的上一节已结束课）。popover 与课堂作业侧栏共用；
 *  各调用点独立请求一次，渲染各自写（错误/空态文案不同）。 */
export function usePrevLessonData(classId: string): PrevLessonState {
  const [state, setState] = useState<PrevLessonState>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    api
      .classDetail(classId)
      .then(async (d) => {
        const info = prevLessonInfo(d.sessions);
        if (!info) {
          if (alive) setState({ status: 'ready', info: null, homework: null, groups: [], stars: [] });
          return;
        }
        const detail = await api.sessionDetail(info.sessionId);
        if (!alive) return;
        setState({
          status: 'ready',
          info,
          homework: info.hasHomework ? detail.homeworkContent : null,
          groups: prevLessonGroups(detail.recap),
          stars: prevLessonStars(detail.recap),
        });
      })
      .catch(() => {
        if (alive) setState({ status: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [classId]);

  return state;
}

export function PrevLessonContent({ classId }: { classId: string }) {
  const state = usePrevLessonData(classId);

  const row = (label: string, value: ReactNode) => (
    <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '5px 0' }}>
      <span style={{ width: 34, flexShrink: 0, fontSize: 13, fontWeight: 700, color: '#a7b0bb' }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 800, color: '#2c3340' }}>{value}</div>
    </div>
  );

  if (state.status !== 'ready') {
    return (
      <div style={{ padding: '6px 0', fontSize: 14, fontWeight: 700, color: '#a7b0bb' }}>
        {state.status === 'error' ? '加载失败，请关闭后重试' : '加载中…'}
      </div>
    );
  }
  if (!state.info) {
    return <div style={{ padding: '6px 0', fontSize: 14, fontWeight: 700, color: '#a7b0bb' }}>本班还没有上课记录</div>;
  }
  return (
    <>
      {row('日期', state.info.dateLabel)}
      {row('课次', state.info.lessonText)}
      {row(
        '分数',
        state.groups.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {state.groups.map((g) => (
              <span
                key={g.name}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '3px 10px',
                  borderRadius: 999,
                  background: '#f1f4f8',
                  fontSize: 13,
                  fontWeight: 800,
                  color: '#4b5563',
                }}
              >
                {g.emoji && <span>{g.emoji}</span>}
                <span>{g.name}</span>
                <span style={{ color: '#2c3340' }}>{g.score}</span>
              </span>
            ))}
          </div>
        ) : (
          <span style={{ color: '#a7b0bb' }}>无分组记录</span>
        ),
      )}
      {row(
        '之星',
        state.stars.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {state.stars.map((s) => (
              <span
                key={s.name}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '3px 10px',
                  borderRadius: 999,
                  background: '#fff7e6',
                  fontSize: 13,
                  fontWeight: 800,
                  color: '#8f6b16',
                }}
              >
                <span>🌟</span>
                <span>{s.name}</span>
                <span style={{ color: '#b8891f' }}>+{s.net}</span>
              </span>
            ))}
          </div>
        ) : (
          <span style={{ color: '#a7b0bb' }}>暂无</span>
        ),
      )}
      {row(
        '作业',
        state.homework ? (
          <div
            style={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'break-word',
              maxHeight: 240,
              overflowY: 'auto',
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.6,
            }}
          >
            {state.homework}
          </div>
        ) : (
          <span style={{ color: '#a7b0bb' }}>未布置作业</span>
        ),
      )}
      <a
        href={`/classes/${classId}/sessions/${state.info.sessionId}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'flex',
          justifyContent: 'center',
          marginTop: 10,
          paddingTop: 12,
          borderTop: '1px solid #eef1f5',
          fontSize: 14,
          fontWeight: 800,
          color: '#3f8f4f',
          textDecoration: 'none',
        }}
      >
        查看上课记录 →
      </a>
    </>
  );
}

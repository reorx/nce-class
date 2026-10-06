import type { ReactNode } from 'react';
import { usePrevLessonQuery } from '../queries/prev-lesson';

// 「上节课」内容体：日期/课次/分数/之星/作业 + 查看上课记录。课堂右上角
// popover 与课前配置页的「上节课回顾」卡共用。数据在服务端（不在离线课堂
// 快照里），由 usePrevLessonQuery 复用班级详情（定位上节课）与该节 session 详情
// （作业文本与 recap：每组分数 / 今日之星）两个共享查询；没有上一节是正常空态。
export function PrevLessonContent({ classId }: { classId: string }) {
  const prev = usePrevLessonQuery(classId);

  const row = (label: string, value: ReactNode) => (
    <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '5px 0' }}>
      <span style={{ width: 34, flexShrink: 0, fontSize: 13, fontWeight: 700, color: '#a7b0bb' }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 800, color: '#2c3340' }}>{value}</div>
    </div>
  );

  const muted = { padding: '6px 0', fontSize: 14, fontWeight: 700, color: '#a7b0bb' } as const;
  if (prev.status === 'pending') return <div style={muted}>加载中…</div>;
  if (prev.status === 'error') {
    return (
      <div style={muted}>
        加载失败 ·{' '}
        <button
          onClick={prev.refetch}
          style={{ border: 'none', background: 'transparent', padding: 0, font: 'inherit', color: '#3f8f4f', cursor: 'pointer' }}
        >
          重试
        </button>
      </div>
    );
  }
  const state = prev.data;
  if (!state) return <div style={muted}>本班还没有上课记录</div>;
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

import { usePrevLessonData } from './PrevLessonContent';

// 课堂「作业检查」右侧栏：上 1/3 只读展示上节课（严格紧邻一节）布置的作业，
// 供检查时对照；下 2/3 是本节课作业 textarea（草稿存 classroomStore，随结束
// 课堂一次性提交）。编辑上课记录时输入区只读——overwrite 不改作业，改去详情页。
export function HomeworkSidebar({
  classId,
  content,
  readOnly,
  onChange,
}: {
  classId: string;
  content: string;
  readOnly: boolean;
  onChange: (v: string) => void;
}) {
  const prev = usePrevLessonData(classId);

  const card: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    background: '#ffffff',
    borderRadius: 26,
    boxShadow: '0 10px 28px rgba(60,90,55,.08)',
    overflow: 'hidden',
  };
  const header = (icon: string, title: string, extra?: string) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 9,
        padding: '15px 20px',
        borderBottom: '2px solid #f0f3ed',
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 19 }}>{icon}</span>
      <span style={{ fontWeight: 900, fontSize: 17, color: '#2c3340' }}>{title}</span>
      {extra && <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 13, color: '#a7b0bb' }}>{extra}</span>}
    </div>
  );
  const muted = (text: string) => (
    <div style={{ padding: '14px 20px', fontSize: 14, fontWeight: 700, color: '#a7b0bb' }}>{text}</div>
  );
  const prose: React.CSSProperties = {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '12px 20px 16px',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    fontSize: 14.5,
    fontWeight: 600,
    lineHeight: 1.6,
    color: '#2c3340',
  };

  return (
    <div style={{ flex: '0 0 30%', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ ...card, flex: 1 }}>
        {header('📚', '上节课作业', prev.status === 'ready' && prev.info ? prev.info.dateLabel : undefined)}
        {prev.status === 'loading' && muted('加载中…')}
        {prev.status === 'error' && muted('加载失败')}
        {prev.status === 'ready' &&
          (!prev.info ? (
            muted('本班还没有上课记录')
          ) : prev.homework ? (
            <div style={prose}>{prev.homework}</div>
          ) : (
            muted('上节课未布置作业')
          ))}
      </div>

      <div style={{ ...card, flex: 2, marginBottom: 6 }}>
        {header('📝', '本节课作业')}
        {readOnly ? (
          <>
            <div
              style={{
                margin: '12px 20px 0',
                padding: '8px 14px',
                borderRadius: 12,
                background: '#e7f0ff',
                color: '#2a6fb0',
                fontWeight: 800,
                fontSize: 13,
                flexShrink: 0,
              }}
            >
              ✏️ 编辑课堂中作业只读 · 请在上课记录详情页修改
            </div>
            {content ? <div style={prose}>{content}</div> : muted('本节课未布置作业')}
          </>
        ) : (
          <textarea
            value={content}
            onChange={(e) => onChange(e.target.value)}
            placeholder="边上课边写：本节课要布置的作业，结束课堂时自动保存"
            style={{
              flex: 1,
              minHeight: 0,
              margin: '12px 16px 16px',
              padding: '12px 14px',
              borderRadius: 16,
              border: '2px solid #eef2ea',
              background: '#fbfdf9',
              resize: 'none',
              outline: 'none',
              fontFamily: 'inherit',
              fontSize: 14.5,
              fontWeight: 600,
              lineHeight: 1.6,
              color: '#2c3340',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = '#7fce97')}
            onBlur={(e) => (e.currentTarget.style.borderColor = '#eef2ea')}
          />
        )}
      </div>
    </div>
  );
}

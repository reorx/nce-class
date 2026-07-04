import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { HomeworkTemplateEditor } from '../components/HomeworkTemplateEditor';
import { RecapPanel } from '../components/RecapPanel';
import { TopBar } from '../components/TopBar';
import { useToast } from '../components/Toast';
import { api, type Me, type SessionDetail as SessionData } from '../lib/api';
import { BOOK_LABELS, BOOKS, clampLesson, lessonOptions, renderHomeworkTemplate } from '../lib/homework';
import { lessonLabel } from '../lib/lesson';
import { GREEN } from '../lib/theme';

// Session 详情页（结束课堂后落地，也可从上课记录点课名进入）：
// 作业布置 tab（模板 + 生成作业内容 + 课文复习级联选择）+ Recap tab（战报预览/导出）。

type Tab = 'homework' | 'recap';

export function SessionDetail({ me }: { me: Me | null }) {
  const { id = '', sid = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'homework';
  const setTab = (t: Tab) => setParams(t === 'homework' ? {} : { tab: t }, { replace: true });
  const [d, setD] = useState<SessionData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .sessionDetail(sid)
      .then(setD)
      .catch(() => setFailed(true));
  }, [sid]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar me={me} active="classes" />
      <div style={{ width: '100%', maxWidth: 1140, margin: '0 auto', padding: '22px 26px 64px' }}>
        <Link
          to={`/classes/${id}?tab=sessions`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: '#7a828f',
            textDecoration: 'none',
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 13,
          }}
        >
          <span style={{ fontSize: 14 }}>←</span>返回上课记录
        </Link>

        <div style={{ marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-.3px' }}>
            {d ? lessonLabel(d.lessonNumber, d.lessonTitle) : ' '}
          </h1>
          {d && (
            <div style={{ marginTop: 8, fontSize: 13.5, color: '#7a828f' }}>
              {d.className} · {d.year}-{d.date} {d.weekday} · {d.durationLabel}
              {d.teacherName ? ` · 主讲 ${d.teacherName}` : ''}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #ebedf1', marginBottom: 22 }}>
          {(['homework', 'recap'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={tabStyle(tab === t)}>
              {t === 'homework' ? '作业布置' : 'Recap'}
            </button>
          ))}
        </div>

        {failed && (
          <div style={{ padding: '80px 20px', textAlign: 'center', color: '#9aa1ac', fontSize: 13.5 }}>
            课堂详情加载失败，请刷新重试
          </div>
        )}
        {!failed && !d && (
          <div style={{ padding: '80px 20px', textAlign: 'center', color: '#9aa1ac', fontSize: 13.5 }}>加载中…</div>
        )}
        {d && tab === 'homework' && <HomeworkTab d={d} onSaved={setD} />}
        {d && tab === 'recap' && <RecapPanel recap={d.recap} className={d.className} year={d.year} />}
      </div>
    </div>
  );
}

// ===== 作业布置 TAB =========================================================
function HomeworkTab({ d, onSaved }: { d: SessionData; onSaved: (fresh: SessionData) => void }) {
  const toast = useToast();
  const [content, setContent] = useState('');
  const [book, setBook] = useState<number | null>(null);
  const [lesson, setLesson] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = () =>
    renderHomeworkTemplate(d.homeworkTemplate ?? '', {
      lessonNumber: d.lessonNumber,
      date: d.date,
      className: d.className,
    });

  // Seed once per session: saved values win; a fresh session auto-generates the
  // content and defaults 课文复习 to 班级教材册数 + 本节课课数.
  useEffect(() => {
    setContent(d.homeworkContent ?? generate());
    const b = d.reviewBook ?? d.classTextbook;
    setBook(b);
    setLesson(d.reviewLesson ?? clampLesson(b, d.lessonNumber));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.id]);

  async function finish() {
    if (busy) return;
    setBusy(true);
    try {
      const fresh = await api.saveSessionHomework(d.id, {
        content,
        reviewBook: book,
        reviewLesson: book != null ? lesson : null,
      });
      onSaved(fresh);
      toast('本节课作业已布置');
    } catch {
      toast('保存失败，请重试', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <HomeworkTemplateEditor
        template={d.homeworkTemplate}
        onSave={async (v) => {
          await api.updateHomeworkTemplate(d.classId, v);
          onSaved(await api.sessionDetail(d.id));
        }}
      />

      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>作业内容</div>
          <div style={{ fontSize: 12.5, color: '#aab1bc' }}>发给家长的最终作业 · 可手动修改</div>
          <button
            style={{ ...ghostBtn, marginLeft: 'auto', height: 34, fontSize: 12.5 }}
            title="按上方模板重新生成，覆盖当前内容"
            onClick={() => setContent(generate())}
          >
            ⟳ 生成
          </button>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="点击「生成」按模板填充，或直接输入本节课作业"
          style={textareaStyle}
        />
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>课文复习</div>
          <div style={{ fontSize: 12.5, color: '#aab1bc' }}>选择本次作业要复习的课文</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <select
            value={book ?? ''}
            onChange={(e) => {
              const b = e.target.value ? Number(e.target.value) : null;
              setBook(b);
              setLesson(clampLesson(b, lesson ?? d.lessonNumber));
            }}
            style={selectStyle}
          >
            <option value="">未选择</option>
            {BOOKS.map((b) => (
              <option key={b} value={b}>
                {BOOK_LABELS[b]}
              </option>
            ))}
          </select>
          <select
            value={lesson ?? ''}
            onChange={(e) => setLesson(e.target.value ? Number(e.target.value) : null)}
            disabled={book == null}
            style={{ ...selectStyle, opacity: book == null ? 0.55 : 1 }}
          >
            <option value="">{book == null ? '先选择册数' : '未选择'}</option>
            {lessonOptions(book).map((n) => (
              <option key={n} value={n}>
                第{n}课
              </option>
            ))}
          </select>
        </div>
        <div
          style={{
            marginTop: 14,
            padding: '26px 16px',
            border: '1px dashed #e2e5ea',
            borderRadius: 10,
            textAlign: 'center',
            color: '#aab1bc',
            fontSize: 13,
          }}
        >
          📚 课文原文与录音将从「教材库」获取，敬请期待
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          style={{
            height: 44,
            padding: '0 26px',
            background: GREEN,
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            fontWeight: 600,
            fontSize: 14.5,
            cursor: 'pointer',
            boxShadow: '0 3px 10px rgba(47,180,87,.24)',
            opacity: busy ? 0.6 : 1,
          }}
          onClick={finish}
          disabled={busy}
        >
          {busy ? '保存中…' : d.hasHomework ? '更新布置' : '完成布置'}
        </button>
      </div>
    </div>
  );
}

const cardStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid #e7e9ee',
  borderRadius: 14,
  padding: '20px 24px',
};
const textareaStyle: CSSProperties = {
  width: '100%',
  minHeight: 170,
  padding: '12px 14px',
  border: '1px solid #e2e5ea',
  borderRadius: 10,
  background: '#fbfcfd',
  color: '#1e2430',
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 13.5,
  lineHeight: 1.65,
  resize: 'vertical',
  outline: 'none',
};
const selectStyle: CSSProperties = {
  height: 40,
  padding: '0 12px',
  border: '1px solid #e2e5ea',
  borderRadius: 9,
  fontSize: 14,
  color: '#1e2430',
  background: '#fbfcfd',
  cursor: 'pointer',
};
const ghostBtn: CSSProperties = {
  height: 40,
  padding: '0 14px',
  background: '#fff',
  color: '#5b6472',
  border: '1px solid #e2e5ea',
  borderRadius: 9,
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};
const tabStyle = (active: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  padding: '11px 15px 12px',
  border: 'none',
  background: 'transparent',
  fontWeight: 600,
  fontSize: 14.5,
  cursor: 'pointer',
  marginBottom: -1,
  borderBottom: `2px solid ${active ? '#2fb457' : 'transparent'}`,
  color: active ? '#1e2430' : '#7a828f',
});

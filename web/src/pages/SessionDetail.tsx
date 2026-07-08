import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { HomeworkTemplateDialog } from '../components/HomeworkTemplateEditor';
import { OverviewTab } from '../components/OverviewTab';
import { RecapPanel } from '../components/RecapPanel';
import { TopBar } from '../components/TopBar';
import { useToast } from '../components/Toast';
import { api, type Me, type SessionDetail as SessionData, type TeacherItem } from '../lib/api';
import { applyStartTime, startTimeOf } from '../lib/classroomStore';
import { BOOK_LABELS, BOOKS, clampLesson, lessonOptions, renderHomeworkTemplate } from '../lib/homework';
import { lessonLabel } from '../lib/lesson';
import { GREEN } from '../lib/theme';

// Session 详情页（结束课堂后落地，也可从上课记录点课名进入）：
// 作业布置 tab（模板 + 生成作业内容 + 课文复习级联选择）+ Recap tab（战报预览/导出）
// + 课堂信息 tab（课次/课题/开始时间/主讲老师 record fix-up，与课堂内弹窗同字段）。

type Tab = 'overview' | 'homework' | 'recap' | 'info';
const TAB_LABELS: Record<Tab, string> = {
  overview: '课堂情况',
  homework: '作业布置',
  recap: 'Recap',
  info: '课堂信息',
};

export function SessionDetail({ me }: { me: Me | null }) {
  const { id = '', sid = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'overview';
  const setTab = (t: Tab) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true });
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
          {(['overview', 'homework', 'recap', 'info'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={tabStyle(tab === t)}>
              {TAB_LABELS[t]}
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
        {d && tab === 'overview' && <OverviewTab d={d} />}
        {d && tab === 'homework' && <HomeworkTab d={d} onSaved={setD} />}
        {d && tab === 'recap' && (
          <RecapPanel recap={d.recap} className={d.className} year={d.year} homework={d.homeworkContent} />
        )}
        {d && tab === 'info' && <InfoTab d={d} onSaved={setD} />}
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
  const [templateOpen, setTemplateOpen] = useState(false);

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
      {d.prevHomework && <PrevHomeworkCard p={d.prevHomework} classId={d.classId} />}

      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>作业内容</div>
          <div style={{ fontSize: 12.5, color: '#aab1bc' }}>发给家长的最终作业 · 可手动修改</div>
          <button
            style={{ ...ghostBtn, marginLeft: 'auto', height: 34, fontSize: 12.5 }}
            title="修改本班级作业模板"
            onClick={() => setTemplateOpen(true)}
          >
            ⚙ 模板设置
          </button>
          <button
            style={{ ...ghostBtn, height: 34, fontSize: 12.5 }}
            title="按模板重新生成，覆盖当前内容"
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

      <HomeworkTemplateDialog
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        template={d.homeworkTemplate}
        onSave={async (v) => {
          await api.updateHomeworkTemplate(d.classId, v);
          onSaved(await api.sessionDetail(d.id));
        }}
      />
    </div>
  );
}

// 上次作业参考：同班里当前课之前最近一节已布置作业的课（服务端 prevHomework），只读展示。
function PrevHomeworkCard({ p, classId }: { p: NonNullable<SessionData['prevHomework']>; classId: string }) {
  return (
    <div style={{ ...cardStyle, background: '#fafbfc' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>上次作业参考</div>
        <div style={{ fontSize: 12.5, color: '#aab1bc' }}>
          {lessonLabel(p.lessonNumber, p.lessonTitle, '未填写课次')} · {p.date} {p.weekday}
        </div>
        <Link
          to={`/classes/${classId}/sessions/${p.sessionId}?tab=homework`}
          style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 600, color: '#7a828f', textDecoration: 'none' }}
        >
          查看该课 →
        </Link>
      </div>
      <pre style={prevContentStyle}>{p.content}</pre>
      {p.reviewBook != null && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: '#7a828f' }}>
          课文复习：{BOOK_LABELS[p.reviewBook]}
          {p.reviewLesson != null ? ` · 第${p.reviewLesson}课` : ''}
        </div>
      )}
    </div>
  );
}

// ===== 课堂信息 TAB =========================================================
// Same fields as the in-classroom LessonInfoDialog (课次/课题/开始时间/主讲老师)
// but in the management system's plain card style; 课堂时长 stays read-only here
// since the actual duration is derived from startedAt/endedAt.
function InfoTab({ d, onSaved }: { d: SessionData; onSaved: (fresh: SessionData) => void }) {
  const toast = useToast();
  const [teachers, setTeachers] = useState<TeacherItem[]>([]);
  const [no, setNo] = useState('');
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('');
  const [timeErr, setTimeErr] = useState('');
  const [tid, setTid] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .teachers()
      .then(setTeachers)
      .catch(() => {});
  }, []);

  // Seed once per session; after a save the echoed payload matches the form.
  useEffect(() => {
    setNo(d.lessonNumber != null ? String(d.lessonNumber) : '');
    setTitle(d.lessonTitle ?? '');
    setTime(d.startedAt ? startTimeOf(d.startedAt) : '');
    setTid(d.teacherId ?? '');
    setTimeErr('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.id]);

  async function save() {
    if (busy) return;
    const patch: Parameters<typeof api.updateSessionInfo>[1] = {
      lessonNumber: no.trim() ? Number(no.trim()) : null,
      lessonTitle: title,
      teacherId: tid || null,
    };
    // Legacy rows without startedAt keep it untouched (key omitted = no write).
    if (d.startedAt) {
      const next = applyStartTime(d.startedAt, time);
      if (!next) {
        setTimeErr('请输入有效的开始时间');
        return;
      }
      if (d.endedAt && next >= d.endedAt) {
        setTimeErr('开始时间必须早于结束时间');
        return;
      }
      patch.startedAt = next;
    }
    setBusy(true);
    try {
      onSaved(await api.updateSessionInfo(d.id, patch));
      toast('课堂信息已保存');
    } catch {
      toast('保存失败，请重试', 'error');
    } finally {
      setBusy(false);
    }
  }

  // 该老师已不可选（如被移出）时仍显示当前值，避免下拉静默丢主讲人
  const tidUnknown = tid !== '' && !teachers.some((t) => t.id === tid);

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>课堂信息</div>
          <div style={{ fontSize: 12.5, color: '#aab1bc' }}>修改会同步到上课记录、Recap 与成长档案</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 14px' }}>
          <div>
            <label style={infoLabel}>课次号</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#aab1bc', fontSize: 14 }}>第</span>
              <input
                value={no}
                onChange={(e) => setNo(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                placeholder="4"
                inputMode="numeric"
                style={{ ...inputStyle, flex: 1, minWidth: 0 }}
              />
              <span style={{ color: '#aab1bc', fontSize: 14 }}>课</span>
            </div>
          </div>
          <div>
            <label style={infoLabel}>开始时间</label>
            <input
              type="time"
              value={time}
              disabled={!d.startedAt}
              title={d.startedAt ? undefined : '旧记录未存开始时间，无法修改'}
              onChange={(e) => {
                setTime(e.target.value);
                setTimeErr('');
              }}
              style={{ ...inputStyle, width: '100%', opacity: d.startedAt ? 1 : 0.55 }}
            />
            {timeErr && <div style={{ color: '#e5484d', fontSize: 12.5, marginTop: 6 }}>{timeErr}</div>}
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={infoLabel}>课题</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="A private conversation"
              style={{ ...inputStyle, width: '100%' }}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={infoLabel}>主讲老师</label>
            <select value={tid} onChange={(e) => setTid(e.target.value)} style={{ ...selectStyle, width: '100%' }}>
              <option value="">未设置</option>
              {tidUnknown && <option value={tid}>{d.teacherName ?? tid}</option>}
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button
            style={{
              height: 42,
              padding: '0 24px',
              background: GREEN,
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontWeight: 600,
              fontSize: 14.5,
              cursor: 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
            onClick={save}
            disabled={busy}
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

const infoLabel: CSSProperties = {
  display: 'block',
  fontSize: 12.5,
  fontWeight: 600,
  color: '#7a828f',
  marginBottom: 7,
};
const inputStyle: CSSProperties = {
  height: 40,
  padding: '0 12px',
  border: '1px solid #e2e5ea',
  borderRadius: 9,
  fontSize: 14,
  color: '#1e2430',
  background: '#fbfcfd',
  outline: 'none',
};

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
const prevContentStyle: CSSProperties = {
  margin: 0,
  padding: '12px 14px',
  border: '1px solid #edeff3',
  borderRadius: 10,
  background: '#fff',
  color: '#5b6472',
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 13,
  lineHeight: 1.65,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
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

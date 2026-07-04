import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, type Session } from '../lib/api';
import { applyStartTime, startTimeOf } from '../lib/classroomStore';
import { lessonLabel } from '../lib/lesson';
import { GREEN } from '../lib/theme';
import { Modal } from './Modal';
import { useToast } from './Toast';

/** A session row plus its owning class; className renders only when showClass. */
export type SessionRow = Session & { classId: string; className?: string };

const fmtDur = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;

const hm = (t: string) => t.slice(11, 16); // 'YYYY-MM-DD HH:mm:ss' -> 'HH:mm'

/**
 * 上课记录列表（班级详情「上课记录」tab 与管理页「课堂」共用）。
 * showClass 时多一列班级名（跳班级详情）；改时间/删除都在行内完成后 reload。
 */
export function SessionsTable({
  sessions,
  showClass = false,
  reload,
  footnote,
  emptyText = '还没有上课记录',
}: {
  sessions: SessionRow[];
  showClass?: boolean;
  reload: () => Promise<void> | void;
  footnote?: ReactNode;
  emptyText?: string;
}) {
  const [pendingDelete, setPendingDelete] = useState<SessionRow | null>(null);
  const [editing, setEditing] = useState<SessionRow | null>(null);
  const [editTime, setEditTime] = useState('');
  const [editErr, setEditErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  function openEdit(s: SessionRow) {
    setEditing(s);
    setEditTime(s.startedAt ? startTimeOf(s.startedAt) : '');
    setEditErr('');
  }

  async function confirmEdit() {
    if (!editing?.startedAt || busy) return;
    const next = applyStartTime(editing.startedAt, editTime);
    if (!next) {
      setEditErr('请输入有效的开始时间');
      return;
    }
    if (editing.endedAt && next >= editing.endedAt) {
      setEditErr('开始时间必须早于结束时间');
      return;
    }
    setBusy(true);
    try {
      await api.updateSessionStartedAt(editing.id, next);
      await reload();
      toast('已更新开始时间');
      setEditing(null);
    } catch {
      toast('保存失败，请重试', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || busy) return;
    setBusy(true);
    try {
      await api.deleteSession(pendingDelete.id);
      await reload();
      toast('已删除该条上课记录');
      setPendingDelete(null);
    } catch {
      toast('删除失败，请重试', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ background: '#fff', border: '1px solid #e7e9ee', borderRadius: 13, overflow: 'hidden' }}>
        <div
          className="mono"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '11px 18px',
            background: '#fafbfc',
            borderBottom: '1px solid #eef0f3',
            fontSize: 10.5,
            letterSpacing: '.7px',
            color: '#a6adb8',
          }}
        >
          <span style={{ width: 96 }}>DATE</span>
          {showClass && <span style={{ width: 118 }}>CLASS</span>}
          <span style={{ flex: 1 }}>LESSON</span>
          <span style={{ width: 118 }}>DURATION</span>
          <span style={{ width: 58 }}>GROUPS</span>
          <span style={{ width: 150, textAlign: 'right' }}>ACTIONS</span>
        </div>
        {sessions.map((s) => {
          const early = s.actualDurationMin < s.plannedDurationMin;
          const over = s.actualDurationMin > s.plannedDurationMin;
          const note = early
            ? `计划 ${fmtDur(s.plannedDurationMin)} · 提前 ${s.plannedDurationMin - s.actualDurationMin} 分`
            : over
              ? `计划 ${fmtDur(s.plannedDurationMin)} · 超时 ${s.actualDurationMin - s.plannedDurationMin} 分`
              : `计划 ${fmtDur(s.plannedDurationMin)}`;
          return (
            <div
              key={s.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '14px 18px',
                borderBottom: '1px solid #f1f3f6',
              }}
            >
              <div style={{ width: 96 }}>
                <div className="mono" style={{ fontWeight: 600, fontSize: 14, color: '#1e2430' }}>
                  {s.date}
                </div>
                <div style={{ fontSize: 11, color: '#a6adb8', marginTop: 2 }}>
                  {s.year} · {s.weekday}
                </div>
                {s.startedAt && (
                  <div className="mono" style={{ fontSize: 11, color: '#a6adb8', marginTop: 2 }}>
                    {hm(s.startedAt)}
                    {s.endedAt ? `–${hm(s.endedAt)}` : ''}
                  </div>
                )}
              </div>
              {showClass && (
                <div style={{ width: 118, minWidth: 0 }}>
                  <Link
                    to={`/classes/${s.classId}`}
                    style={{
                      display: 'block',
                      fontWeight: 600,
                      fontSize: 13,
                      color: '#5b6472',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      textDecoration: 'none',
                    }}
                  >
                    {s.className}
                  </Link>
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  <Link
                    to={`/classes/${s.classId}/sessions/${s.id}`}
                    title="查看课堂详情（作业布置 / Recap）"
                    style={{
                      fontWeight: 600,
                      fontSize: 14.5,
                      color: '#1e2430',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      textDecoration: 'none',
                    }}
                  >
                    {lessonLabel(s.lessonNumber, s.lessonTitle)}
                  </Link>
                  {s.hasHomework && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#2c7a48',
                        background: '#eef7f0',
                        padding: '2px 8px',
                        borderRadius: 999,
                      }}
                    >
                      已布置
                    </span>
                  )}
                </div>
                {s.teacherName && (
                  <div style={{ fontSize: 11, color: '#a6adb8', marginTop: 2 }}>主讲 {s.teacherName}</div>
                )}
              </div>
              <div style={{ width: 118 }}>
                <div className="mono" style={{ fontWeight: 600, fontSize: 13.5, color: '#3c4451' }}>
                  {s.durationLabel}
                </div>
                <div style={{ fontSize: 11, color: early ? '#c58a1e' : '#a6adb8', marginTop: 2 }}>{note}</div>
              </div>
              <div style={{ width: 58, fontSize: 13, color: '#5b6472' }}>{s.groupCount} 组</div>
              <div style={{ width: 150, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                {s.startedAt && (
                  <button
                    onClick={() => openEdit(s)}
                    title="修改这节课的开始时间"
                    style={{
                      height: 34,
                      padding: '0 10px',
                      background: 'transparent',
                      color: '#a6adb8',
                      border: '1px solid transparent',
                      borderRadius: 8,
                      fontWeight: 600,
                      fontSize: 12.5,
                      cursor: 'pointer',
                    }}
                  >
                    改时间
                  </button>
                )}
                <button
                  onClick={() => setPendingDelete(s)}
                  title="删除这条上课记录"
                  style={{
                    height: 34,
                    padding: '0 10px',
                    background: 'transparent',
                    color: '#a6adb8',
                    border: '1px solid transparent',
                    borderRadius: 8,
                    fontWeight: 600,
                    fontSize: 12.5,
                    cursor: 'pointer',
                  }}
                >
                  删除
                </button>
              </div>
            </div>
          );
        })}
        {sessions.length === 0 && (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: '#9aa1ac', fontSize: 13.5 }}>{emptyText}</div>
        )}
      </div>
      {footnote && <div style={{ marginTop: 12, fontSize: 12, color: '#a6adb8', textAlign: 'center' }}>{footnote}</div>}

      <Modal open={!!editing} onClose={() => setEditing(null)} title="修改开始时间">
        <div style={{ fontSize: 14, color: '#3c4451', lineHeight: 1.7, marginBottom: 16 }}>
          <b>{editing && [editing.className, editing.date].filter(Boolean).join(' · ')}</b>「
          <b>{editing && lessonLabel(editing.lessonNumber, editing.lessonTitle)}</b>」 · 结束时间{' '}
          <b className="mono">{editing?.endedAt ? hm(editing.endedAt) : '—'}</b>
          ，修改开始时间后课堂时长会重新计算。
        </div>
        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#5b6472', marginBottom: 6 }}>
          开始时间
        </label>
        <input
          type="time"
          value={editTime}
          autoFocus
          onChange={(e) => {
            setEditTime(e.target.value);
            setEditErr('');
          }}
          onKeyDown={(e) => e.key === 'Enter' && confirmEdit()}
          style={fieldStyle}
        />
        {editErr && <div style={{ color: '#ff5a5f', fontSize: 13, fontWeight: 700, marginTop: 8 }}>{editErr}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
          <button style={ghostBtn} onClick={() => setEditing(null)}>
            取消
          </button>
          <button style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} onClick={confirmEdit}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </Modal>

      <Modal open={!!pendingDelete} onClose={() => setPendingDelete(null)} title="删除上课记录">
        <div style={{ fontSize: 14, color: '#3c4451', lineHeight: 1.7 }}>
          确定删除 <b>{pendingDelete && [pendingDelete.className, pendingDelete.date].filter(Boolean).join(' · ')}</b>「
          <b>{pendingDelete && lessonLabel(pendingDelete.lessonNumber, pendingDelete.lessonTitle)}</b>
          」这条上课记录吗？该节课的得分、背书作业与出勤都会一并清除，且不可恢复。
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
          <button style={ghostBtn} onClick={() => setPendingDelete(null)}>
            取消
          </button>
          <button
            style={{ ...primaryBtn, background: '#d94a4a', boxShadow: 'none', opacity: busy ? 0.6 : 1 }}
            onClick={confirmDelete}
          >
            {busy ? '删除中…' : '删除'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

const fieldStyle: CSSProperties = {
  width: '100%',
  height: 40,
  padding: '0 12px',
  border: '1px solid #e2e5ea',
  borderRadius: 9,
  fontSize: 14,
  color: '#1e2430',
  background: '#fbfcfd',
};
const primaryBtn: CSSProperties = {
  height: 40,
  padding: '0 18px',
  background: GREEN,
  color: '#fff',
  border: 'none',
  borderRadius: 9,
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};
const ghostBtn: CSSProperties = {
  height: 40,
  padding: '0 18px',
  background: '#fff',
  color: '#5b6472',
  border: '1px solid #e2e5ea',
  borderRadius: 9,
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};

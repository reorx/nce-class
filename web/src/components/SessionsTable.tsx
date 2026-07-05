import { useState, type ReactNode, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { api, type Session } from '../lib/api';
import { lessonLabel } from '../lib/lesson';
import { GREEN } from '../lib/theme';
import { Modal } from './Modal';
import { useToast } from './Toast';

/** A session row plus its owning class; className renders only when showClass. */
export type SessionRow = Session & { classId: string; className?: string };

const hm = (t: string) => t.slice(11, 16); // 'YYYY-MM-DD HH:mm:ss' -> 'HH:mm'

/**
 * 上课记录列表（班级详情「上课记录」tab 与管理页「课堂」共用）。
 * showClass 时多一列班级名（跳班级详情）；改时间等课堂信息修改在 session
 * 详情页「课堂信息」tab 做，行内只留删除。
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
  const [busy, setBusy] = useState(false);
  const toast = useToast();

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
          <span style={{ width: 92 }}>TIME</span>
          {showClass && <span style={{ width: 118 }}>CLASS</span>}
          <span style={{ flex: 1 }}>LESSON</span>
          <span style={{ width: 76 }}>主讲</span>
          <span style={{ width: 64 }}>作业</span>
          <span style={{ width: 64, textAlign: 'right' }}>ACTIONS</span>
        </div>
        {sessions.map((s) => (
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
            </div>
            <div className="mono" style={{ width: 92, fontSize: 12.5, color: '#5b6472' }}>
              {s.startedAt ? (
                <>
                  {hm(s.startedAt)}
                  {s.endedAt ? `–${hm(s.endedAt)}` : ''}
                </>
              ) : (
                '—'
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
              <Link
                to={`/classes/${s.classId}/sessions/${s.id}`}
                title="查看课堂详情（作业布置 / Recap / 课堂信息）"
                style={{
                  display: 'block',
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
            </div>
            <div
              style={{
                width: 76,
                fontSize: 13,
                color: '#5b6472',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {s.teacherName ?? '—'}
            </div>
            <div style={{ width: 64 }}>
              {s.hasHomework ? (
                <span
                  style={{
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
              ) : (
                <span style={{ fontSize: 12, color: '#a6adb8' }}>未布置</span>
              )}
            </div>
            <div style={{ width: 64, display: 'flex', justifyContent: 'flex-end' }}>
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
        ))}
        {sessions.length === 0 && (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: '#9aa1ac', fontSize: 13.5 }}>{emptyText}</div>
        )}
      </div>
      {footnote && <div style={{ marginTop: 12, fontSize: 12, color: '#a6adb8', textAlign: 'center' }}>{footnote}</div>}

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

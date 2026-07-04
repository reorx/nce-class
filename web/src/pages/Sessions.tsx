import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SessionsTable } from '../components/SessionsTable';
import { TopBar } from '../components/TopBar';
import { api, type ClassListItem, type Me, type SessionListItem } from '../lib/api';

/** Rebuild 'YYYY-MM-DD' from the split payload fields for naive string-order range checks. */
const fullDate = (s: SessionListItem) => `${s.year}-${s.date}`;

/** 管理页「课堂」：全校上课记录，按时间倒序，可按班级/日期范围过滤（纯前端，URL 可分享）。 */
export function Sessions({ me }: { me: Me | null }) {
  const [params, setParams] = useSearchParams();
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const [classes, setClasses] = useState<ClassListItem[]>([]);

  const classId = params.get('classId') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const hasFilter = !!(classId || from || to);

  function setFilter(patch: Partial<{ classId: string; from: string; to: string }>) {
    const next = { classId, from, to, ...patch };
    const p: Record<string, string> = {};
    if (next.classId) p.classId = next.classId;
    if (next.from) p.from = next.from;
    if (next.to) p.to = next.to;
    setParams(p, { replace: true });
  }

  const reload = () =>
    api
      .listSessions()
      .then(setSessions)
      .catch(() => {});

  useEffect(() => {
    reload();
    api
      .classes()
      .then(setClasses)
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    if (!sessions) return [];
    return sessions.filter((s) => {
      if (classId && s.classId !== classId) return false;
      const d = fullDate(s);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [sessions, classId, from, to]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar me={me} active="sessions" />
      <div style={{ flex: 1, width: '100%', maxWidth: 1140, margin: '0 auto', padding: '30px 26px 64px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-.3px' }}>课堂</h1>
            <div style={{ marginTop: 6, fontSize: 13.5, color: '#7a828f' }}>
              全校上课记录，最新在前
              {sessions &&
                (hasFilter ? ` · 筛出 ${filtered.length} / ${sessions.length} 节` : ` · 共 ${sessions.length} 节`)}
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <select
              value={classId}
              onChange={(e) => setFilter({ classId: e.target.value })}
              style={{ ...filterField, minWidth: 140 }}
            >
              <option value="">全部班级</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={from}
              onChange={(e) => setFilter({ from: e.target.value })}
              title="起始日期"
              style={filterField}
            />
            <span style={{ color: '#a6adb8', fontSize: 13 }}>—</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setFilter({ to: e.target.value })}
              title="截止日期"
              style={filterField}
            />
            {hasFilter && (
              <button onClick={() => setParams({}, { replace: true })} style={clearBtn}>
                清除筛选
              </button>
            )}
          </div>
        </div>

        <SessionsTable
          sessions={filtered}
          showClass
          reload={reload}
          emptyText={sessions === null ? '加载中…' : hasFilter ? '没有符合筛选条件的课堂记录' : '还没有上课记录'}
        />
      </div>
    </div>
  );
}

const filterField: CSSProperties = {
  height: 36,
  padding: '0 10px',
  border: '1px solid #e2e5ea',
  borderRadius: 9,
  fontSize: 13.5,
  color: '#1e2430',
  background: '#fff',
};
const clearBtn: CSSProperties = {
  height: 36,
  padding: '0 12px',
  background: 'transparent',
  color: '#7a828f',
  border: '1px solid transparent',
  borderRadius: 9,
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
};

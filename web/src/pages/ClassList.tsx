import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClassInfoModal } from '../components/ClassInfoModal';
import { TopBar } from '../components/TopBar';
import { useToast } from '../components/Toast';
import { api, type ClassListItem, type Me } from '../lib/api';
import { loadSession } from '../lib/classroomStore';
import { GREEN, GREEN_DARK, PAL } from '../lib/theme';

const ORANGE = '#f0862a';
const ORANGE_DARK = '#dd7317';

const parseLocal = (t: string) => Date.parse(t.replace(' ', 'T'));

function fmtTimer(elapsed: number): string {
  const hh = Math.floor(elapsed / 3600);
  const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** Seconds since the in-progress local classroom started, or null when none. */
function useLiveClassroom(classId: string): number | null {
  const startMs = useMemo(() => {
    const s = loadSession(classId);
    return s ? parseLocal(s.startedAt) : null;
  }, [classId]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (startMs == null) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startMs]);
  return startMs == null ? null : Math.max(0, Math.floor((nowMs - startMs) / 1000));
}

export function ClassList({ me }: { me: Me | null }) {
  const [classes, setClasses] = useState<ClassListItem[]>([]);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const toast = useToast();
  const nav = useNavigate();

  const reload = () =>
    api
      .classes()
      .then(setClasses)
      .catch(() => {});

  useEffect(() => {
    reload();
  }, []);

  const list = useMemo(
    () => classes.filter((c) => !search.trim() || c.name.includes(search.trim())),
    [classes, search],
  );
  const studentTotal = classes.reduce((a, c) => a + c.studentCount, 0);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar me={me} active="classes" />
      <div style={{ flex: 1, width: '100%', maxWidth: 1140, margin: '0 auto', padding: '30px 26px 64px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-.3px' }}>班级</h1>
            <div style={{ marginTop: 6, fontSize: 13.5, color: '#7a828f' }}>
              {classes.length} 个班级 · 共 {studentTotal} 名学生
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                height: 38,
                padding: '0 12px',
                background: '#fff',
                border: '1px solid #e7e9ee',
                borderRadius: 9,
              }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#a6adb8"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.5" y2="16.5" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索班级"
                style={{ border: 'none', background: 'transparent', fontSize: 13.5, width: 148, color: '#1e2430' }}
              />
            </div>
            <button
              onClick={() => setCreateOpen(true)}
              style={{
                height: 38,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '0 16px',
                background: GREEN,
                color: '#fff',
                border: 'none',
                borderRadius: 9,
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(47,180,87,.26)',
              }}
            >
              <span style={{ fontSize: 17, fontWeight: 400, lineHeight: 1 }}>+</span>新建班级
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(312px,1fr))', gap: 15 }}>
          {list.map((c, ci) => (
            <ClassCard key={c.id} c={c} ci={ci} />
          ))}
        </div>

        {list.length === 0 && (
          <div style={{ textAlign: 'center', padding: '64px 20px', color: '#9aa1ac' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#5b6472', marginBottom: 5 }}>没有匹配的班级</div>
            <div style={{ fontSize: 13 }}>试试其他关键词，或新建一个班级</div>
          </div>
        )}
      </div>

      <ClassInfoModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建班级"
        submitLabel="创建班级"
        busyLabel="创建中…"
        errorText="创建失败，请重试"
        initial={{ name: '', teacherId: me?.id ?? '', textbook: null }}
        fallbackTeacherName={me?.name}
        onSubmit={async (v) => {
          const created = await api.createClass(v);
          await reload();
          toast(`已创建「${v.name}」`);
          nav(`/classes/${created.id}`);
        }}
      />
    </div>
  );
}

function ClassCard({ c, ci }: { c: ClassListItem; ci: number }) {
  const shown = c.roster.slice(0, 4);
  const liveSec = useLiveClassroom(c.id);
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e7e9ee',
        borderRadius: 13,
        padding: '17px 17px 15px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 16.5,
              color: '#1e2430',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {c.name}
          </div>
        </div>
        <div
          className="mono"
          style={{
            marginLeft: 'auto',
            flexShrink: 0,
            fontSize: 12,
            fontWeight: 600,
            color: '#3f7a56',
            background: '#eef6f0',
            border: '1px solid #dcecdf',
            padding: '3px 9px',
            borderRadius: 7,
          }}
        >
          {c.studentCount} 人
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', marginTop: 15, minHeight: 28 }}>
        {shown.map((nm, i) => {
          const p = PAL[(ci + i) % PAL.length];
          return (
            <div
              key={i}
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                border: '2px solid #fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 600,
                fontSize: 11,
                background: p.bg,
                color: p.fg,
                marginLeft: i === 0 ? 0 : -8,
                position: 'relative',
                zIndex: 10 - i,
              }}
            >
              {nm[0]}
            </div>
          );
        })}
        {c.studentCount > 4 && (
          <div
            className="mono"
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: '#f0f2f5',
              border: '2px solid #fff',
              marginLeft: -8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10.5,
              fontWeight: 600,
              color: '#7a828f',
              position: 'relative',
              zIndex: 1,
            }}
          >
            +{c.studentCount - 4}
          </div>
        )}
      </div>

      <div style={{ marginTop: 15, display: 'flex', flexDirection: 'column', gap: 7 }}>
        {liveSec != null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <span style={{ color: '#a6adb8', width: 52 }}>本节课</span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '2px 9px',
                borderRadius: 7,
                background: '#fdf3e5',
                border: '1px solid #f6e0c2',
                color: '#c05f0a',
                fontWeight: 600,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: ORANGE, flexShrink: 0 }} />
              课堂进行中
              <span className="mono" style={{ fontSize: 11.5, fontWeight: 600 }}>
                {fmtTimer(liveSec)}
              </span>
            </span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
          <span style={{ color: '#a6adb8', width: 52 }}>上次上课</span>
          <span style={{ fontWeight: 600, color: '#5b6472' }}>{c.lastSession?.relative ?? '尚未上课'}</span>
          <span className="mono" style={{ color: '#aab1bc', fontSize: 11.5 }}>
            {c.lastSession ? `${c.lastSession.date} ${c.lastSession.weekday}` : '—'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
          <span style={{ color: '#a6adb8', width: 52 }}>负责老师</span>
          <span style={{ fontWeight: 600, color: '#5b6472' }}>{c.teacherName}</span>
        </div>
      </div>

      <div style={{ height: 1, background: '#eef0f3', margin: '15px 0 13px' }} />
      <div style={{ display: 'flex', gap: 9 }}>
        <Link
          to={liveSec != null ? `/classes/${c.id}/classroom` : `/classes/${c.id}/setup`}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            height: 38,
            background: liveSec != null ? ORANGE : GREEN,
            color: '#fff',
            borderRadius: 9,
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: 13.5,
            boxShadow: liveSec != null ? '0 2px 7px rgba(240,134,42,.28)' : '0 2px 7px rgba(47,180,87,.24)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = liveSec != null ? ORANGE_DARK : GREEN_DARK)}
          onMouseLeave={(e) => (e.currentTarget.style.background = liveSec != null ? ORANGE : GREEN)}
        >
          <span style={{ fontSize: 9 }}>{liveSec != null ? '↻' : '▶'}</span>
          {liveSec != null ? '返回课堂' : '开始上课'}
        </Link>
        <Link
          to={`/classes/${c.id}/attendance`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 15px',
            height: 38,
            background: '#fff',
            color: '#3c4451',
            border: '1px solid #e2e5ea',
            borderRadius: 9,
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: 13.5,
          }}
        >
          考勤
        </Link>
        <Link
          to={`/classes/${c.id}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 17px',
            height: 38,
            background: '#fff',
            color: '#3c4451',
            border: '1px solid #e2e5ea',
            borderRadius: 9,
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: 13.5,
          }}
        >
          管理
        </Link>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { TopBar } from '../components/TopBar';
import { api, type ClassDetail as Detail, type Me, type Student } from '../lib/api';
import { avatarStyle, GREEN, initial } from '../lib/theme';

type Tab = 'students' | 'groups' | 'invite' | 'sessions';
const TABS: Tab[] = ['students', 'groups', 'invite', 'sessions'];

export function ClassDetail({ me }: { me: Me | null }) {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [d, setD] = useState<Detail | null>(null);
  const tab = (params.get('tab') as Tab) || 'students';
  const setTab = (t: Tab) => setParams(t === 'students' ? {} : { tab: t }, { replace: true });

  useEffect(() => {
    api
      .classDetail(id)
      .then(setD)
      .catch(() => {});
  }, [id]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar me={me} active="classes" />
      <div style={{ width: '100%', maxWidth: 1140, margin: '0 auto', padding: '22px 26px 64px' }}>
        <Link
          to="/"
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
          <span style={{ fontSize: 14 }}>←</span>返回班级
        </Link>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-.3px' }}>{d?.name ?? ' '}</h1>
              {d?.level && (
                <span
                  className="mono"
                  style={{ fontSize: 12, color: '#7a828f', background: '#f0f2f5', padding: '3px 9px', borderRadius: 7 }}
                >
                  {d.level}
                </span>
              )}
            </div>
            <div style={{ marginTop: 8, fontSize: 13.5, color: '#7a828f', whiteSpace: 'nowrap' }}>
              {d?.studentCount ?? 0} 名学生 · {d?.groupCount ?? 0} 个分组 · 负责老师 {d?.teacherName ?? ''}
            </div>
          </div>
          <Link
            to={`/classes/${id}/setup`}
            style={{
              marginLeft: 'auto',
              height: 40,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '0 20px',
              background: GREEN,
              color: '#fff',
              borderRadius: 10,
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: 14.5,
              boxShadow: '0 3px 10px rgba(47,180,87,.24)',
            }}
          >
            <span style={{ fontSize: 9 }}>▶</span>开始上课
          </Link>
        </div>

        <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #ebedf1', marginBottom: 22 }}>
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} style={tabStyle(tab === t)}>
              {tabLabel(t)}
              {t === 'students' && <TabCount n={d?.studentCount} />}
              {t === 'sessions' && <TabCount n={d?.sessionCount} />}
            </button>
          ))}
        </div>

        {d && tab === 'students' && <StudentsTab d={d} />}
        {d && tab === 'groups' && <GroupsTab d={d} />}
        {d && tab === 'invite' && <InviteTab d={d} />}
        {d && tab === 'sessions' && <SessionsTab d={d} />}
      </div>
    </div>
  );
}

function TabCount({ n }: { n?: number }) {
  return (
    <span className="mono" style={{ fontSize: 12, color: '#aab1bc' }}>
      {n ?? ''}
    </span>
  );
}
const tabLabel = (t: Tab) => ({ students: '学生', groups: '分组方案', invite: '邀请家长', sessions: '上课记录' })[t];
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

// ---- source tag -----------------------------------------------------------
function sourceTag(source: 'parent' | 'teacher') {
  return source === 'parent'
    ? { label: '家长自助', color: '#586099', bg: '#eef0f8' }
    : { label: '老师添加', color: '#6b7280', bg: '#f0f2f5' };
}

// ===== STUDENTS TAB ========================================================
function StudentsTab({ d }: { d: Detail }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'parent' | 'teacher'>('all');

  const dupNames = useMemo(() => {
    const byName = new Map<string, number>();
    d.students.forEach((s) => byName.set(s.name, (byName.get(s.name) ?? 0) + 1));
    return new Set([...byName].filter(([, n]) => n > 1).map(([n]) => n));
  }, [d.students]);

  const roster = useMemo(() => {
    let list = d.students.slice();
    if (filter !== 'all') list = list.filter((s) => s.source === filter);
    if (search.trim()) list = list.filter((s) => s.name.includes(search.trim()));
    list.sort((a, b) => b.score - a.score);
    return list;
  }, [d.students, filter, search]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 36,
            padding: '0 12px',
            background: '#fff',
            border: '1px solid #e7e9ee',
            borderRadius: 9,
          }}
        >
          <svg
            width="14"
            height="14"
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
            placeholder="搜索学生"
            style={{ border: 'none', background: 'transparent', fontSize: 13, width: 130, color: '#1e2430' }}
          />
        </div>
        <div style={{ display: 'flex', background: '#eef1f5', borderRadius: 9, padding: 3 }}>
          {(
            [
              ['all', '全部'],
              ['parent', '家长自助'],
              ['teacher', '老师添加'],
            ] as const
          ).map(([k, label]) => {
            const on = filter === k;
            return (
              <button
                key={k}
                onClick={() => setFilter(k)}
                style={{
                  padding: '6px 13px',
                  border: 'none',
                  borderRadius: 7,
                  fontWeight: 600,
                  fontSize: 12.5,
                  cursor: 'pointer',
                  background: on ? '#fff' : 'transparent',
                  color: on ? '#1e2430' : '#7a828f',
                  boxShadow: on ? '0 1px 3px rgba(20,28,45,.1)' : 'none',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <button
          style={{
            marginLeft: 'auto',
            height: 36,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 15px',
            background: GREEN,
            color: '#fff',
            border: 'none',
            borderRadius: 9,
            fontWeight: 600,
            fontSize: 13.5,
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(47,180,87,.24)',
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 400, lineHeight: 1 }}>+</span>手动添加学生
        </button>
      </div>

      {dupNames.size > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '13px 16px',
            background: '#fdf6e7',
            border: '1px solid #f0dcae',
            borderRadius: 11,
            marginBottom: 16,
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#c58a1e"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5, color: '#8a6413' }}>
              发现 {dupNames.size} 组疑似重复学生（{[...dupNames].join('、')}）
            </div>
            <div style={{ fontSize: 12, color: '#a8823a', marginTop: 2 }}>
              家长自助加入可能与老师添加的记录重复，可合并保留一条。
            </div>
          </div>
          <button
            style={{
              height: 34,
              padding: '0 15px',
              background: '#fff',
              color: '#8a6413',
              border: '1px solid #e6cd93',
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            查看并合并
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(222px,1fr))', gap: 12 }}>
        {roster.map((s) => (
          <StudentCard key={s.id} s={s} dup={dupNames.has(s.name)} />
        ))}
      </div>
      {roster.length === 0 && (
        <div style={{ textAlign: 'center', padding: '56px 20px', color: '#9aa1ac', fontSize: 13.5 }}>
          没有匹配的学生
        </div>
      )}
    </div>
  );
}

function StudentCard({ s, dup }: { s: Student; dup: boolean }) {
  const tag = sourceTag(s.source);
  return (
    <div
      style={{
        position: 'relative',
        background: '#fff',
        border: `1px solid ${dup ? '#f0dcae' : '#e7e9ee'}`,
        borderRadius: 12,
        padding: '15px 14px 13px',
      }}
    >
      <button
        style={{
          position: 'absolute',
          top: 9,
          right: 8,
          width: 26,
          height: 26,
          border: 'none',
          background: 'transparent',
          borderRadius: 7,
          color: '#aab1bc',
          fontSize: 17,
          lineHeight: 1,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        ⋯
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <div style={avatarStyle(s.id, 46, s.hasPhoto)}>{initial(s.name)}</div>
        <div style={{ minWidth: 0, paddingRight: 18 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: 15,
              color: '#1e2430',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {s.name}
          </div>
          <div
            style={{
              marginTop: 5,
              display: 'inline-block',
              fontSize: 10.5,
              fontWeight: 600,
              color: tag.color,
              background: tag.bg,
              padding: '2px 7px',
              borderRadius: 5,
            }}
          >
            {tag.label}
          </div>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 13,
          paddingTop: 12,
          borderTop: '1px solid #f1f3f6',
        }}
      >
        <span style={{ color: '#f2a83a', fontSize: 13 }}>★</span>
        <span className="mono" style={{ fontWeight: 600, fontSize: 15, color: '#1e2430' }}>
          {s.score}
        </span>
        <span style={{ fontSize: 11.5, color: '#9aa1ac' }}>累计个人分</span>
        {dup && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              fontWeight: 600,
              color: '#a86a12',
              background: '#faf1df',
              padding: '2px 6px',
              borderRadius: 5,
            }}
          >
            疑似重复
          </span>
        )}
      </div>
    </div>
  );
}

// ===== GROUPS TAB ==========================================================
function GroupsTab({ d }: { d: Detail }) {
  const byId = useMemo(() => new Map(d.students.map((s) => [s.id, s])), [d.students]);
  const ungrouped = d.students.filter((s) => !s.groupId);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#1e2430' }}>默认分组方案</div>
          <div style={{ fontSize: 12.5, color: '#7a828f', marginTop: 3 }}>
            开始课堂时以此为初始分组，课中可临时调整。本班仅维护这一套默认分组。
          </div>
        </div>
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '7px 13px',
            borderRadius: 9,
            background: '#f0f4f7',
            color: '#5b7387',
            fontWeight: 600,
            fontSize: 12.5,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#7c93a5"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />
          </svg>
          拖拽学生卡在组间调整
        </div>
      </div>

      <div style={{ display: 'flex', gap: 13, overflowX: 'auto', paddingBottom: 6 }}>
        {d.groups.map((g) => (
          <div
            key={g.id}
            style={{
              width: 236,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              border: '1.5px solid #e7e9ee',
              background: '#fff',
              borderRadius: 13,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 11px',
                borderBottom: '1px solid #eef0f3',
                background: '#fafbfc',
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>{g.emoji}</span>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14.5, color: '#1e2430' }}>{g.name}</span>
              <span
                className="mono"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#7a828f',
                  background: '#eef1f5',
                  padding: '2px 8px',
                  borderRadius: 6,
                }}
              >
                {g.memberIds.length}
              </span>
              <button
                style={{
                  width: 22,
                  height: 22,
                  border: 'none',
                  background: 'transparent',
                  borderRadius: 6,
                  color: '#c0c6cf',
                  fontSize: 17,
                  lineHeight: 1,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ×
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 96, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {g.memberIds.map((mid) => {
                const s = byId.get(mid);
                if (!s) return null;
                return (
                  <div
                    key={mid}
                    draggable
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      borderRadius: 10,
                      background: '#fff',
                      border: '1px solid #eef0f3',
                      cursor: 'grab',
                    }}
                  >
                    <div style={avatarStyle(s.id, 32, s.hasPhoto)}>{initial(s.name)}</div>
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: 14,
                        color: '#1e2430',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        minWidth: 0,
                      }}
                    >
                      {s.name}
                    </span>
                    <span style={{ marginLeft: 'auto', color: '#c6ccd4', fontSize: 14 }}>⠿</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <button
          style={{
            width: 150,
            flexShrink: 0,
            alignSelf: 'flex-start',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            minHeight: 150,
            border: '1.5px dashed #d3d9df',
            background: 'transparent',
            borderRadius: 13,
            color: '#8a929e',
            fontWeight: 600,
            fontSize: 13.5,
            cursor: 'pointer',
          }}
        >
          + 新增小组
        </button>
      </div>

      <div
        style={{
          marginTop: 14,
          border: '1.5px dashed #d3d9df',
          background: '#fbfcfd',
          borderRadius: 12,
          padding: '13px 15px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: ungrouped.length === 0 ? 0 : 12 }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: '#5b6472' }}>未分组</span>
          <span
            className="mono"
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: '#7a828f',
              background: '#eef1f5',
              padding: '2px 8px',
              borderRadius: 6,
            }}
          >
            {ungrouped.length}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#a6adb8' }}>
            留在此处的学生，开课时默认不计分，直到分入某组
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9 }}>
          {ungrouped.length === 0 && (
            <span style={{ color: '#b7bec8', fontSize: 13, fontWeight: 500, padding: 2 }}>全部学生已分组 ✓</span>
          )}
          {ungrouped.map((s) => (
            <div
              key={s.id}
              draggable
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px 6px 6px',
                borderRadius: 10,
                background: '#fff',
                border: '1px solid #e2e6ea',
                cursor: 'grab',
              }}
            >
              <div style={avatarStyle(s.id, 32, s.hasPhoto)}>{initial(s.name)}</div>
              <span style={{ fontWeight: 600, fontSize: 13.5, color: '#5b6472', whiteSpace: 'nowrap' }}>{s.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===== INVITE TAB ==========================================================
function InviteTab({ d }: { d: Detail }) {
  return (
    <div style={{ maxWidth: 620 }}>
      <div style={{ background: '#fff', border: '1px solid #e7e9ee', borderRadius: 14, padding: 24 }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: '#1e2430' }}>家长邀请链接</div>
        <div style={{ fontSize: 13, color: '#7a828f', marginTop: 5, lineHeight: 1.6 }}>
          家长用微信打开链接，上传照片 +
          填名字即可加入本班（source=parent）。链接通用、不做认领匹配，出现重复可在「学生」里合并。
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 18,
            padding: '0 5px 0 14px',
            height: 44,
            background: '#f6f7f9',
            border: '1px solid #e7e9ee',
            borderRadius: 10,
          }}
        >
          <span
            className="mono"
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 13,
              color: '#5b6472',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {d.inviteLink}
          </span>
          <button
            onClick={() => navigator.clipboard?.writeText(d.inviteLink).catch(() => {})}
            style={{
              flexShrink: 0,
              height: 34,
              padding: '0 15px',
              background: GREEN,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            复制
          </button>
        </div>
        <div style={{ display: 'flex', gap: 20, marginTop: 22, alignItems: 'center' }}>
          <div
            style={{
              width: 150,
              height: 150,
              flexShrink: 0,
              borderRadius: 12,
              border: '1px solid #e7e9ee',
              backgroundImage: 'repeating-linear-gradient(45deg,#eef1f5,#eef1f5 6px,#f8f9fb 6px,#f8f9fb 12px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span
              className="mono"
              style={{
                fontSize: 11,
                color: '#98a1af',
                background: 'rgba(255,255,255,.85)',
                padding: '4px 8px',
                borderRadius: 6,
              }}
            >
              二维码
            </span>
          </div>
          <div style={{ fontSize: 13, color: '#7a828f', lineHeight: 1.7 }}>
            <div style={{ fontWeight: 600, color: '#3c4451', marginBottom: 5 }}>课堂上出示二维码</div>
            让家长扫码进入加入页；也可复制链接转发到班级群。
            <br />
            加入成功后，家长会自动跳到孩子的专属回顾链接，提示收藏。
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== SESSIONS TAB ========================================================
const fmtDur = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;

function SessionsTab({ d }: { d: Detail }) {
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
          <span style={{ flex: 1 }}>LESSON</span>
          <span style={{ width: 118 }}>DURATION</span>
          <span style={{ width: 58 }}>GROUPS</span>
          <span style={{ width: 104, textAlign: 'right' }}>RECAP</span>
        </div>
        {d.sessions.map((s) => {
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
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 14.5,
                    color: '#1e2430',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {s.lessonNumber != null ? `第${s.lessonNumber}课 · ${s.lessonTitle}` : s.lessonTitle}
                </div>
              </div>
              <div style={{ width: 118 }}>
                <div className="mono" style={{ fontWeight: 600, fontSize: 13.5, color: '#3c4451' }}>
                  {s.durationLabel}
                </div>
                <div style={{ fontSize: 11, color: early ? '#c58a1e' : '#a6adb8', marginTop: 2 }}>{note}</div>
              </div>
              <div style={{ width: 58, fontSize: 13, color: '#5b6472' }}>{s.groupCount} 组</div>
              <div style={{ width: 104, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    height: 34,
                    padding: '0 13px',
                    background: '#fff',
                    color: '#3c4451',
                    border: '1px solid #e2e5ea',
                    borderRadius: 8,
                    fontWeight: 600,
                    fontSize: 12.5,
                    cursor: 'pointer',
                  }}
                >
                  查看 recap
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 12, fontSize: 12, color: '#a6adb8', textAlign: 'center' }}>
        仅展示本班历次课堂 · recap 家长可在专属链接查看个性化版本
      </div>
    </div>
  );
}

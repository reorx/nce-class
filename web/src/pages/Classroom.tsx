import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { ApiError, api } from '../lib/api';
import {
  buildClassroomSession,
  buildCommitPayload,
  clearSession,
  loadSession,
  newClientSessionId,
  nowSql,
  reducer,
  saveSession,
  type CAction,
  type ClassroomSession,
  type ClassroomStudent,
} from '../lib/classroomStore';
import { configFromDetail, lessonLabel as fmtLessonLabel } from '../lib/setup';
import {
  GRAY,
  GROUP_COLORS,
  HOMEWORK_MAP,
  RECITE_MAP,
  gScore,
  sScore,
  stars as recapStars,
  warned as recapWarned,
  type Homework,
  type Recitation,
  type SEvent,
  type SGroup,
  type SStudent,
} from '../lib/session';

// Teacher-facing classroom console (§7.3). One interactive board with a dock
// that swaps between five views; scoring is an event stream (see lib/session).
// The whole lesson runs in local state (lib/classroomStore), persisted to
// LocalStorage after every change, and is POSTed once at 结束课堂.
type View = 'board' | 'recite' | 'homework' | 'attendance' | 'regroup';

const FONT = "'Nunito','PingFang SC','Microsoft YaHei',system-ui,sans-serif";
const NUM = "'Baloo 2','Nunito','PingFang SC',sans-serif";

/** Parse a naive 'YYYY-MM-DD HH:mm:ss' as local wall-clock ms. */
const parseLocal = (t: string) => Date.parse(t.replace(' ', 'T'));

export function Classroom() {
  const { id = 'c1' } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();

  const [session, setSession] = useState<ClassroomSession | null>(null);
  // 'loading' until we know whether to resume / boot / redirect (decision 13).
  const [phase, setPhase] = useState<'loading' | 'ready' | 'redirect'>('loading');
  const [view, setView] = useState<View>('board');
  const [openId, setOpenId] = useState<string | null>(null);
  const [openGid, setOpenGid] = useState<string | null>(null);
  const [showEnd, setShowEnd] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const dragId = useRef<string | null>(null);

  // ---- boot: resume from store · else URL-param boot · else → 课前配置 -------
  useEffect(() => {
    const stored = loadSession(id);
    if (stored) {
      setSession(stored);
      setPhase('ready');
      return;
    }
    const sp = new URLSearchParams(loc.search);
    const lesson = sp.get('lesson');
    const title = sp.get('title');
    const duration = sp.get('duration');
    if (lesson || title || duration) {
      api
        .classDetail(id)
        .then((d) => {
          const cfg = configFromDetail(d, {
            lessonNumber: (lesson ?? '').replace(/[^0-9]/g, ''),
            lessonTitle: title ?? '',
            durationMin: Math.max(1, Number(duration) || 120),
            className: d.name,
          });
          const fresh = buildClassroomSession(cfg, {
            classId: id,
            clientSessionId: newClientSessionId(),
            startedAt: nowSql(),
          });
          saveSession(fresh);
          setSession(fresh);
          setPhase('ready');
        })
        .catch(() => setPhase('redirect'));
      return;
    }
    setPhase('redirect');
  }, [id, loc.search]);

  // Persist after every local change (offline-first).
  useEffect(() => {
    if (session) saveSession(session);
  }, [session]);

  // 1s tick drives the countdown off the persisted startedAt (survives refresh).
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const dispatch = (a: CAction) => setSession((s) => (s ? reducer(s, a) : s));

  if (phase === 'redirect') return <Navigate to={`/classes/${id}/setup`} replace />;
  if (phase === 'loading' || !session) return <Splash />;

  const { students, groups, events } = session;
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const colorOf = (gid: string) =>
    GROUP_COLORS[
      Math.max(
        0,
        groups.findIndex((g) => g.id === gid),
      ) % GROUP_COLORS.length
    ];

  // ---- mutations (pure reducer + persistence) -----------------------------
  const addStudentScore = (sid: string, d: 1 | -1) => dispatch({ type: 'scoreStudent', sid, d, at: nowSql() });
  const addGroupScore = (gid: string, d: 1 | -1) => dispatch({ type: 'scoreGroup', gid, d, at: nowSql() });
  const undo = () => dispatch({ type: 'undo' });
  const setRecite = (sid: string, v: Recitation) => dispatch({ type: 'setRecite', sid, v });
  const setHomework = (sid: string, v: Homework) => dispatch({ type: 'setHomework', sid, v });
  const toggleAbsent = (sid: string) => dispatch({ type: 'toggleAttendance', sid });
  const moveStudent = (sid: string, gid: string) => dispatch({ type: 'moveStudent', sid, gid });

  const goView = (v: View) => {
    setView(v);
    setOpenId(null);
    setOpenGid(null);
  };

  // ---- countdown / overtime (§7.3) ----------------------------------------
  const elapsedSec = Math.max(0, Math.floor((nowMs - parseLocal(session.startedAt)) / 1000));
  const remainingSec = session.plannedDurationMin * 60 - elapsedSec;
  const overtime = remainingSec < 0;
  const timerStr = fmtTimer(Math.abs(remainingSec));

  const className = session.className ?? '班级';
  const lessonLabel = fmtLessonLabel({
    lessonNumber: session.lessonNumber ?? '',
    lessonTitle: session.lessonTitle ?? '',
  });
  const isBoard = view === 'board' || view === 'regroup';

  // ---- end class: commit the whole session once, then to 上课记录 ----------
  const confirmEnd = () => {
    if (submitting) return;
    setSubmitting(true);
    api
      .commitSession(id, buildCommitPayload(session, nowSql()))
      .then(() => {
        clearSession(id);
        toast('本节课已保存 · 已生成课堂回顾', 'success');
        nav(`/classes/${id}?tab=sessions`);
      })
      .catch((e) => {
        setSubmitting(false);
        toast(e instanceof ApiError ? e.message : '保存失败，请重试', 'error');
      });
  };

  // 放弃本节课: the only self-rescue for a broken local session (decision 12).
  const discard = () => {
    clearSession(id);
    nav(`/classes/${id}?tab=sessions`);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#e9f3e4',
        color: '#2c3340',
        fontFamily: FONT,
      }}
    >
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '16px 26px 12px', gap: 14, flexShrink: 0 }}>
        <span style={{ fontSize: 28 }}>🏫</span>
        <span style={{ fontWeight: 900, fontSize: 25, color: '#2c3340' }}>{className}</span>
        <span style={{ color: '#b7c5ad', fontSize: 22, fontWeight: 800 }}>·</span>
        <span style={{ fontWeight: 700, fontSize: 20, color: '#66756c' }}>{lessonLabel}</span>
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '9px 20px',
            borderRadius: 16,
            background: overtime ? '#ff5a5f' : '#2fb457',
            color: '#fff',
            fontWeight: 800,
            fontSize: 21,
            boxShadow: overtime ? '0 5px 14px rgba(255,90,95,.32)' : '0 5px 14px rgba(47,180,87,.32)',
          }}
        >
          <span style={{ fontSize: 18 }}>{overtime ? '⏰' : '⏱'}</span>
          <span style={{ fontFamily: NUM, letterSpacing: '.5px', fontVariantNumeric: 'tabular-nums' }}>
            {overtime ? `+${timerStr}` : timerStr}
          </span>
          {overtime && <span style={{ fontSize: 13, fontWeight: 800, opacity: 0.9 }}>超时</span>}
        </div>
      </div>

      {/* body */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '0 22px' }}>
        {isBoard && (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {view === 'regroup' && (
              <div
                style={{
                  margin: '2px 0 12px',
                  padding: '11px 18px',
                  borderRadius: 14,
                  background: '#fff6e0',
                  color: '#b9791a',
                  fontWeight: 700,
                  fontSize: 15,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 18 }}>✋</span>拖拽学生卡可在组间移动 · 调组只影响后续加分归属，不改写历史组分
              </div>
            )}
            <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 18, paddingBottom: 6 }}>
              {groups.map((g) => {
                const c = colorOf(g.id);
                const inGroup = students.filter((s) => s.g === g.id && s.attendance === 'present');
                const absentNames = students
                  .filter((s) => s.g === g.id && s.attendance === 'absent')
                  .map((s) => s.name);
                return (
                  <div
                    key={g.id}
                    onDragOver={view === 'regroup' ? (e) => e.preventDefault() : undefined}
                    onDrop={
                      view === 'regroup'
                        ? (e) => {
                            e.preventDefault();
                            if (dragId.current != null) moveStudent(dragId.current, g.id);
                            dragId.current = null;
                          }
                        : undefined
                    }
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      background: '#ffffff',
                      borderRadius: 26,
                      boxShadow: '0 10px 28px rgba(60,90,55,.08)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      onClick={() => setOpenGid(g.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '14px 13px',
                        background: c.headBg,
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ fontSize: 25, lineHeight: 1, flexShrink: 0 }}>{g.emoji}</span>
                      <span
                        style={{
                          fontWeight: 900,
                          fontSize: 20,
                          color: c.headFg,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          minWidth: 0,
                        }}
                      >
                        {g.name}
                      </span>
                      <div
                        style={{
                          marginLeft: 'auto',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '6px 13px',
                          borderRadius: 13,
                          background: 'rgba(255,255,255,.9)',
                          color: c.headFg,
                          fontFamily: NUM,
                          fontWeight: 800,
                          fontSize: 21,
                          lineHeight: 1,
                          flexShrink: 0,
                        }}
                      >
                        <span style={{ fontSize: 16 }}>⭐</span>
                        {gScore(events, g.id)}
                      </div>
                    </div>
                    <div
                      style={{
                        flex: 1,
                        minHeight: 0,
                        padding: '20px 14px 14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 14,
                        overflow: 'auto',
                      }}
                    >
                      {inGroup.map((s) => (
                        <StudentBoardCard
                          key={s.id}
                          s={s}
                          ring={c.ring}
                          score={sScore(events, s.id)}
                          draggable={view === 'regroup'}
                          onDragStart={() => (dragId.current = s.id)}
                          onClick={view === 'board' ? () => setOpenId(s.id) : undefined}
                        />
                      ))}
                      {absentNames.length > 0 && (
                        <div
                          style={{
                            marginTop: 'auto',
                            padding: '8px 6px 2px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            color: '#a7b0bb',
                            fontSize: 13,
                            fontWeight: 700,
                          }}
                        >
                          <span style={{ fontSize: 13 }}>🚪</span>
                          {absentNames.join('、')} 未到
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!isBoard && (
          <SegmentView
            view={view}
            students={students}
            groups={groups}
            colorOf={colorOf}
            onBadge={(sid) => (view === 'attendance' ? toggleAbsent(sid) : setOpenId(sid))}
          />
        )}
      </div>

      {/* dock */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 22px 18px', flexShrink: 0 }}>
        <button onClick={() => goView('attendance')} style={attnStyle(view === 'attendance')}>
          <span style={{ fontSize: 17 }}>📋</span>出勤
        </button>
        <div style={{ display: 'flex', gap: 6, background: '#eef2ea', padding: 6, borderRadius: 18 }}>
          {(
            [
              ['board', '上课'],
              ['recite', '背书检查'],
              ['homework', '作业检查'],
              ['regroup', '调组'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} onClick={() => goView(k)} style={tabStyle(view === k)}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={() => setShowDiscard(true)} style={discardStyle}>
            退出不保存
          </button>
          <button onClick={undo} style={undoStyle(events.length > 0)}>
            <span style={{ fontSize: 16 }}>↩</span>撤销
          </button>
          <button
            onClick={() => {
              setShowEnd(true);
              setOpenId(null);
              setOpenGid(null);
            }}
            style={{
              padding: '11px 26px',
              borderRadius: 14,
              border: 'none',
              background: '#ff5a5f',
              color: '#fff',
              fontWeight: 800,
              fontSize: 16,
              fontFamily: 'inherit',
              cursor: 'pointer',
              boxShadow: '0 5px 14px rgba(255,90,95,.34)',
            }}
          >
            结束课堂
          </button>
        </div>
      </div>

      {/* student popup */}
      {openId != null &&
        (() => {
          const st = students.find((x) => x.id === openId);
          if (!st) return null;
          const g = groupById.get(st.g);
          const c = colorOf(st.g);
          const sc = sScore(events, st.id);
          const hint = sc >= 0 ? `本节 个人 +${sc} · 小组同步 +${sc}` : `本节 个人 ${sc} · 小组同步 ${sc}`;
          return (
            <StudentPopup
              st={st}
              group={g ?? { id: st.g, name: '未分组', emoji: '🚪' }}
              ring={c.ring}
              score={sc}
              hint={hint}
              onMinus={() => addStudentScore(st.id, -1)}
              onPlus={() => addStudentScore(st.id, 1)}
              onRecite={(v) => setRecite(st.id, v)}
              onHomework={(v) => setHomework(st.id, v)}
              onClose={() => setOpenId(null)}
            />
          );
        })()}

      {/* group popup */}
      {openGid != null &&
        (() => {
          const g = groupById.get(openGid);
          if (!g) return null;
          const c = colorOf(g.id);
          return (
            <GroupPopup
              group={g}
              headFg={c.headFg}
              score={gScore(events, g.id)}
              onMinus={() => addGroupScore(g.id, -1)}
              onPlus={() => addGroupScore(g.id, 1)}
              onClose={() => setOpenGid(null)}
            />
          );
        })()}

      {/* end-class recap (local preview → confirm commits) */}
      {showEnd && (
        <EndRecap
          className={className}
          lesson={lessonLabel}
          groups={groups}
          students={students}
          events={events}
          submitting={submitting}
          colorOf={colorOf}
          onClose={() => !submitting && setShowEnd(false)}
          onConfirm={confirmEnd}
        />
      )}

      {/* discard confirmation */}
      {showDiscard && (
        <Overlay z={65} onClose={() => setShowDiscard(false)} strong>
          <div style={popupCard(440)} onClick={stop}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <span style={{ fontSize: 28 }}>⚠️</span>
              <span style={{ fontWeight: 900, fontSize: 22, color: '#2c3340' }}>放弃本节课？</span>
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#66756c', lineHeight: 1.6, marginBottom: 22 }}>
              本节课的加减分、背书 / 作业、出勤记录将全部丢弃且不会保存到后端。此操作不可撤销。
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={() => setShowDiscard(false)}
                style={{
                  flex: 1,
                  padding: 14,
                  borderRadius: 16,
                  border: '2px solid #dfe6da',
                  background: '#fff',
                  color: '#5b6672',
                  fontWeight: 800,
                  fontSize: 16,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                }}
              >
                返回课堂
              </button>
              <button
                onClick={discard}
                style={{
                  flex: 1,
                  padding: 14,
                  borderRadius: 16,
                  border: 'none',
                  background: '#ff5a5f',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: 16,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  boxShadow: '0 5px 14px rgba(255,90,95,.3)',
                }}
              >
                放弃并退出
              </button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}

function Splash() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#e9f3e4',
        color: '#8a94a0',
        fontSize: 15,
        fontWeight: 700,
        fontFamily: FONT,
      }}
    >
      加载课堂…
    </div>
  );
}

// ===== board student card ==================================================
function StudentBoardCard({
  s,
  ring,
  score,
  draggable,
  onDragStart,
  onClick,
}: {
  s: SStudent;
  ring: string;
  score: number;
  draggable: boolean;
  onDragStart: () => void;
  onClick?: () => void;
}) {
  const r = s.r ? RECITE_MAP[s.r] : GRAY;
  const h = s.h ? HOMEWORK_MAP[s.h] : GRAY;
  const scoreBg = score > 0 ? '#e4f8ea' : score < 0 ? '#ffe4e4' : '#eef1f4';
  const scoreFg = score > 0 ? '#1e9e4a' : score < 0 ? '#e0454a' : '#98a2b0';
  return (
    <div
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onClick={onClick}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 13,
        padding: '13px 15px',
        borderRadius: 18,
        background: '#f6f9f2',
        border: '2px solid #eef3e8',
        cursor: draggable ? 'grab' : 'pointer',
        transition: 'transform .12s,box-shadow .12s,border-color .12s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = '#c7e3bc';
        e.currentTarget.style.boxShadow = '0 6px 16px rgba(60,90,55,.1)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#eef3e8';
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.transform = 'none';
      }}
    >
      <div style={{ position: 'absolute', top: -11, right: 12, display: 'flex', gap: 5, zIndex: 2 }}>
        <Badge text="背" bg={r.dot} />
        <Badge text="作" bg={h.dot} />
      </div>
      <div style={ringAvatar(44, ring, 18)}>{s.name[0]}</div>
      <span style={{ fontWeight: 800, fontSize: 19, color: '#2c3340', whiteSpace: 'nowrap' }}>{s.name}</span>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 40,
            padding: '5px 10px',
            borderRadius: 12,
            background: scoreBg,
            color: scoreFg,
            fontFamily: NUM,
            fontWeight: 800,
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          {score > 0 ? `+${score}` : String(score)}
        </div>
      </div>
    </div>
  );
}

function Badge({ text, bg }: { text: string; bg: string }) {
  return (
    <div
      style={{
        padding: '3px 8px',
        borderRadius: 9,
        fontSize: 13,
        fontWeight: 800,
        color: '#fff',
        lineHeight: 1.25,
        background: bg,
        boxShadow: '0 2px 6px rgba(60,90,55,.2)',
      }}
    >
      {text}
    </div>
  );
}

// ===== segmented views (背书检查 / 作业检查 / 出勤) =========================
interface Seg {
  title: string;
  dot: string;
  soft: string;
  students: ClassroomStudent[];
  empty?: boolean;
}

function SegmentView({
  view,
  students,
  groups,
  colorOf,
  onBadge,
}: {
  view: View;
  students: ClassroomStudent[];
  groups: SGroup[];
  colorOf: (gid: string) => (typeof GROUP_COLORS)[number];
  onBadge: (sid: string) => void;
}) {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const total = students.length;
  const bucket = (pred: (s: ClassroomStudent) => boolean) => students.filter(pred);

  let icon = '',
    title = '',
    progress = '',
    segs: Seg[] = [];
  if (view === 'recite') {
    const done = students.filter((s) => s.r !== null).length;
    icon = '📖';
    title = '背书检查';
    progress = `已检查 ${done} / ${total}`;
    segs = [
      { title: '未检查', dot: '#c9cfd6', soft: '#f4f6f8', students: bucket((s) => s.r === null) },
      { title: '已背完', dot: '#34c759', soft: '#eaf9ef', students: bucket((s) => s.r === '已背完') },
      { title: '背完部分', dot: '#ffb020', soft: '#fff6e0', students: bucket((s) => s.r === '背完部分') },
      { title: '没背', dot: '#c9cfd6', soft: '#eef1f4', students: bucket((s) => s.r === '没背') },
    ];
  } else if (view === 'homework') {
    const done = students.filter((s) => s.h !== null).length;
    icon = '📝';
    title = '作业检查';
    progress = `已批改 ${done} / ${total}`;
    segs = [
      { title: '未批改', dot: '#c9cfd6', soft: '#f4f6f8', students: bucket((s) => s.h === null) },
      { title: '完成', dot: '#34c759', soft: '#eaf9ef', students: bucket((s) => s.h === '完成') },
      { title: '没交', dot: '#c9cfd6', soft: '#eef1f4', students: bucket((s) => s.h === '没交') },
    ];
  } else {
    const present = students.filter((s) => s.attendance === 'present');
    const away = students.filter((s) => s.attendance === 'absent');
    icon = '📋';
    title = '出勤点名';
    progress = `已到勤 ${present.length} / ${total}`;
    segs = [
      { title: '已到勤', dot: '#34c759', soft: '#eaf9ef', students: present },
      { title: '未到勤', dot: '#ff5a5f', soft: '#ffedee', students: away, empty: away.length === 0 },
    ];
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#ffffff',
        borderRadius: 26,
        boxShadow: '0 10px 28px rgba(60,90,55,.08)',
        overflow: 'hidden',
        marginBottom: 6,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '18px 24px',
          borderBottom: '2px solid #f0f3ed',
        }}
      >
        <span style={{ fontSize: 26 }}>{icon}</span>
        <span style={{ fontWeight: 900, fontSize: 22, color: '#2c3340' }}>{title}</span>
        <div
          style={{
            marginLeft: 'auto',
            padding: '8px 18px',
            borderRadius: 14,
            background: '#eef2ea',
            color: '#5b6672',
            fontWeight: 800,
            fontSize: 16,
          }}
        >
          {progress}
        </div>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: '8px 24px 20px',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {segs.map((seg) => (
          <div key={seg.title} style={{ padding: '16px 0', borderBottom: '1px solid #f2f5ef' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
              <span style={{ width: 14, height: 14, borderRadius: '50%', background: seg.dot, flexShrink: 0 }} />
              <span style={{ fontWeight: 800, fontSize: 18, color: '#3a4350' }}>{seg.title}</span>
              <span
                style={{
                  padding: '2px 11px',
                  borderRadius: 11,
                  background: seg.soft,
                  color: '#5b6672',
                  fontWeight: 800,
                  fontSize: 14,
                }}
              >
                {seg.students.length}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {seg.empty && (
                <span style={{ color: '#a7b0bb', fontSize: 15, fontWeight: 600, padding: '8px 4px' }}>
                  🎉 全员到齐，没有缺勤的同学
                </span>
              )}
              {seg.students.map((s) => {
                const g = groupById.get(s.g);
                const c = colorOf(s.g);
                return (
                  <div
                    key={s.id}
                    onClick={() => onBadge(s.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 15px 8px 8px',
                      borderRadius: 16,
                      background: seg.soft,
                      border: '2px solid transparent',
                      cursor: 'pointer',
                      transition: 'transform .12s,border-color .12s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = seg.dot;
                      e.currentTarget.style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'transparent';
                      e.currentTarget.style.transform = 'none';
                    }}
                  >
                    <div style={{ position: 'relative', width: 40, height: 40, flexShrink: 0 }}>
                      <div style={ringAvatar(40, c.ring, 16)}>{s.name[0]}</div>
                      <span style={{ position: 'absolute', bottom: -3, right: -5, fontSize: 15, lineHeight: 1 }}>
                        {g?.emoji ?? '🚪'}
                      </span>
                    </div>
                    <span style={{ fontWeight: 800, fontSize: 17, color: '#2c3340' }}>{s.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {view === 'attendance' && (
          <div
            style={{
              marginTop: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '16px 20px',
              borderRadius: 18,
              background: '#f6f9f2',
              border: '2px solid #e3edda',
            }}
          >
            <span
              style={{
                width: 46,
                height: 46,
                borderRadius: 14,
                background: '#eafaef',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 24,
                flexShrink: 0,
              }}
            >
              📅
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontWeight: 900, fontSize: 18, color: '#2c3340' }}>历史出勤</span>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#8a94a0' }}>
                查看本学期 16 次课的完整出勤表 · 类 Excel 手动登记
              </span>
            </div>
            <span style={{ marginLeft: 'auto', fontSize: 22, color: '#2fb457', fontWeight: 800 }}>→</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== student popup =======================================================
function StudentPopup({
  st,
  group,
  ring,
  score,
  hint,
  onMinus,
  onPlus,
  onRecite,
  onHomework,
  onClose,
}: {
  st: SStudent;
  group: SGroup;
  ring: string;
  score: number;
  hint: string;
  onMinus: () => void;
  onPlus: () => void;
  onRecite: (v: Recitation) => void;
  onHomework: (v: Homework) => void;
  onClose: () => void;
}) {
  const scoreColor = score > 0 ? '#1e9e4a' : score < 0 ? '#e0454a' : '#98a2b0';
  return (
    <Overlay z={50} onClose={onClose}>
      <div style={popupCard(460)} onClick={stop}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
          <div style={{ position: 'relative', width: 60, height: 60, flexShrink: 0 }}>
            <div style={ringAvatar(60, ring, 24, 3)}>{st.name[0]}</div>
            <span style={{ position: 'absolute', bottom: -4, right: -6, fontSize: 22, lineHeight: 1 }}>
              {group.emoji}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontWeight: 900, fontSize: 24, color: '#2c3340' }}>{st.name}</span>
            <span style={{ fontWeight: 700, fontSize: 15, color: '#8a94a0' }}>{group.name}</span>
          </div>
          <button onClick={onClose} style={closeBtn}>
            ✕
          </button>
        </div>

        <div style={{ background: '#f6f9f2', borderRadius: 20, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button onClick={onMinus} style={minusBtn}>
              −1
            </button>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontFamily: NUM, fontWeight: 800, fontSize: 44, lineHeight: 1, color: scoreColor }}>
                {score > 0 ? `+${score}` : String(score)}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#98a2b0', marginTop: 3 }}>本节个人分</div>
            </div>
            <button onClick={onPlus} style={plusBtn}>
              +1
            </button>
          </div>
          <div style={{ textAlign: 'center', marginTop: 12, fontSize: 13, fontWeight: 700, color: '#8a94a0' }}>
            {hint}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#5b6672', marginBottom: 9 }}>📖 背书</div>
          <div style={{ display: 'flex', gap: 9 }}>
            {(['已背完', '背完部分', '没背'] as const).map((v) => (
              <button key={v} onClick={() => onRecite(v)} style={optStyle(st.r === v, RECITE_MAP[v])}>
                {v}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#5b6672', marginBottom: 9 }}>📝 作业</div>
          <div style={{ display: 'flex', gap: 9 }}>
            {(['完成', '没交'] as const).map((v) => (
              <button key={v} onClick={() => onHomework(v)} style={optStyle(st.h === v, HOMEWORK_MAP[v])}>
                {v}
              </button>
            ))}
          </div>
        </div>

        <button onClick={onClose} style={doneBtn}>
          完成
        </button>
      </div>
    </Overlay>
  );
}

// ===== group popup =========================================================
function GroupPopup({
  group,
  headFg,
  score,
  onMinus,
  onPlus,
  onClose,
}: {
  group: SGroup;
  headFg: string;
  score: number;
  onMinus: () => void;
  onPlus: () => void;
  onClose: () => void;
}) {
  return (
    <Overlay z={55} onClose={onClose}>
      <div style={popupCard(420)} onClick={stop}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 22 }}>
          <span style={{ fontSize: 34, lineHeight: 1, flexShrink: 0 }}>{group.emoji}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontWeight: 900, fontSize: 24, color: '#2c3340' }}>{group.name}</span>
            <span style={{ fontWeight: 700, fontSize: 15, color: '#8a94a0' }}>小组积分</span>
          </div>
          <button onClick={onClose} style={closeBtn}>
            ✕
          </button>
        </div>

        <div style={{ background: '#f6f9f2', borderRadius: 20, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button onClick={onMinus} style={minusBtn}>
              −1
            </button>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  fontFamily: NUM,
                  fontWeight: 800,
                  fontSize: 44,
                  lineHeight: 1,
                  color: headFg,
                }}
              >
                <span style={{ fontSize: 30 }}>⭐</span>
                {score}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#98a2b0', marginTop: 5 }}>本节小组总分</div>
            </div>
            <button onClick={onPlus} style={plusBtn}>
              +1
            </button>
          </div>
          <div style={{ textAlign: 'center', marginTop: 12, fontSize: 13, fontWeight: 700, color: '#8a94a0' }}>
            仅计入小组分，不影响任何学生的个人分
          </div>
        </div>

        <button onClick={onClose} style={{ ...doneBtn, marginTop: 18 }}>
          完成
        </button>
      </div>
    </Overlay>
  );
}

// ===== end-class recap =====================================================
function EndRecap({
  className,
  lesson,
  groups,
  students,
  events,
  submitting,
  colorOf,
  onClose,
  onConfirm,
}: {
  className: string;
  lesson: string;
  groups: SGroup[];
  students: ClassroomStudent[];
  events: SEvent[];
  submitting: boolean;
  colorOf: (gid: string) => (typeof GROUP_COLORS)[number];
  onClose: () => void;
  onConfirm: () => void;
}) {
  const ranking = [...groups]
    .map((g) => ({ ...g, score: gScore(events, g.id), c: colorOf(g.id) }))
    .sort((a, b) => b.score - a.score)
    .map((g, i) => ({ ...g, medal: ['🥇', '🥈', '🥉'][i] || '' }));
  const stars = recapStars(students, events);
  const warned = recapWarned(students, events);
  return (
    <Overlay z={60} onClose={onClose} strong>
      <div
        style={{
          width: 600,
          maxWidth: '94vw',
          maxHeight: '88vh',
          overflow: 'auto',
          background: '#fff',
          borderRadius: 30,
          padding: '28px 30px 24px',
          boxShadow: '0 30px 70px rgba(20,40,20,.3)',
          animation: 'pop-in .22s cubic-bezier(.2,.9,.3,1.2)',
        }}
        onClick={stop}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <span style={{ fontSize: 30 }}>🎉</span>
          <span style={{ fontWeight: 900, fontSize: 25, color: '#2c3340' }}>本堂课回顾</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: '#8a94a0', marginTop: 6 }}>
            {className} · {lesson}
          </span>
          <button onClick={onClose} style={{ ...closeBtn, marginLeft: 'auto' }}>
            ✕
          </button>
        </div>

        <div style={{ fontWeight: 800, fontSize: 16, color: '#5b6672', marginBottom: 12 }}>🏆 各组得分</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          {ranking.map((g) => (
            <div
              key={g.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '13px 16px',
                borderRadius: 16,
                background: g.c.headBg,
              }}
            >
              <span style={{ fontSize: 22, width: 26, textAlign: 'center' }}>{g.medal}</span>
              <span style={{ fontSize: 24 }}>{g.emoji}</span>
              <span style={{ fontWeight: 800, fontSize: 19, color: g.c.headFg }}>{g.name}</span>
              <div
                style={{
                  marginLeft: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontFamily: NUM,
                  fontWeight: 800,
                  fontSize: 24,
                  color: g.c.headFg,
                }}
              >
                <span style={{ fontSize: 18 }}>⭐</span>
                {g.score}
              </div>
            </div>
          ))}
        </div>

        <div style={{ fontWeight: 800, fontSize: 16, color: '#5b6672', marginBottom: 12 }}>🌟 表现亮眼</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 22 }}>
          {stars.length === 0 && <span style={{ color: '#a7b0bb', fontSize: 14 }}>暂无</span>}
          {stars.map((s) => (
            <RecapBadge key={s.id} name={s.name} ring={colorOf(s.g).ring} bg="#eaf9ef" fg="#1e9e4a" />
          ))}
        </div>

        <div style={{ fontWeight: 800, fontSize: 16, color: '#5b6672', marginBottom: 12 }}>⚠️ 被老师提醒</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 26 }}>
          {warned.length === 0 && <span style={{ color: '#a7b0bb', fontSize: 14 }}>暂无</span>}
          {warned.map((s) => (
            <RecapBadge key={s.id} name={s.name} ring={colorOf(s.g).ring} bg="#ffedee" fg="#e0454a" />
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              flex: 1,
              padding: 15,
              borderRadius: 16,
              border: '2px solid #dfe6da',
              background: '#fff',
              color: '#5b6672',
              fontWeight: 800,
              fontSize: 17,
              fontFamily: 'inherit',
              cursor: submitting ? 'default' : 'pointer',
              opacity: submitting ? 0.5 : 1,
            }}
          >
            返回课堂
          </button>
          <button
            onClick={onConfirm}
            disabled={submitting}
            style={{
              flex: 2,
              padding: 15,
              borderRadius: 16,
              border: 'none',
              background: '#2fb457',
              color: '#fff',
              fontWeight: 800,
              fontSize: 17,
              fontFamily: 'inherit',
              cursor: submitting ? 'default' : 'pointer',
              opacity: submitting ? 0.7 : 1,
              boxShadow: '0 5px 14px rgba(47,180,87,.3)',
            }}
          >
            {submitting ? '保存中…' : '确认结束 · 生成 recap 推送家长'}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function RecapBadge({ name, ring, bg, fg }: { name: string; ring: string; bg: string; fg: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '8px 15px 8px 8px',
        borderRadius: 16,
        background: bg,
      }}
    >
      <div style={ringAvatar(36, ring, 15)}>{name[0]}</div>
      <span style={{ fontWeight: 800, fontSize: 16, color: fg }}>{name}</span>
    </div>
  );
}

// ===== shared overlay ======================================================
function Overlay({
  children,
  z,
  onClose,
  strong,
}: {
  children: React.ReactNode;
  z: number;
  onClose: () => void;
  strong?: boolean;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: z,
        background: strong ? 'rgba(28,40,26,.36)' : 'rgba(28,40,26,.32)',
        backdropFilter: strong ? 'blur(4px)' : 'blur(3px)',
        WebkitBackdropFilter: strong ? 'blur(4px)' : 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'ov-in .16s ease',
      }}
    >
      {children}
    </div>
  );
}

const stop = (e: React.MouseEvent) => e.stopPropagation();

// ===== style helpers =======================================================
function ringAvatar(size: number, ring: string, fontSize: number, border = 2.5): CSSProperties {
  return {
    width: size,
    height: size,
    borderRadius: '50%',
    background: '#dbe1e8',
    color: '#7c8794',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 800,
    fontSize,
    flexShrink: 0,
    border: `${border}px solid ${ring}`,
  };
}

function popupCard(width: number): CSSProperties {
  return {
    width,
    maxWidth: '92vw',
    background: '#fff',
    borderRadius: 30,
    padding: '26px 28px 24px',
    boxShadow: '0 30px 70px rgba(20,40,20,.28)',
    animation: 'pop-in .2s cubic-bezier(.2,.9,.3,1.2)',
  };
}

const closeBtn: CSSProperties = {
  marginLeft: 'auto',
  width: 38,
  height: 38,
  borderRadius: 12,
  border: 'none',
  background: '#f0f3ed',
  color: '#8a94a0',
  fontSize: 20,
  cursor: 'pointer',
  lineHeight: 1,
  alignSelf: 'flex-start',
};

const minusBtn: CSSProperties = {
  width: 74,
  height: 64,
  borderRadius: 18,
  border: 'none',
  background: '#ffe4e4',
  color: '#e0454a',
  fontSize: 32,
  fontWeight: 800,
  lineHeight: 1,
  cursor: 'pointer',
  flexShrink: 0,
  fontFamily: 'inherit',
};

const plusBtn: CSSProperties = {
  width: 74,
  height: 64,
  borderRadius: 18,
  border: 'none',
  background: '#2fb457',
  color: '#fff',
  fontSize: 32,
  fontWeight: 800,
  lineHeight: 1,
  cursor: 'pointer',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 5px 14px rgba(47,180,87,.34)',
  fontFamily: 'inherit',
};

const doneBtn: CSSProperties = {
  width: '100%',
  padding: 15,
  borderRadius: 16,
  border: 'none',
  background: '#2fb457',
  color: '#fff',
  fontWeight: 800,
  fontSize: 18,
  fontFamily: 'inherit',
  cursor: 'pointer',
  boxShadow: '0 5px 14px rgba(47,180,87,.3)',
};

function optStyle(sel: boolean, m: { dot: string; soft: string; fg: string }): CSSProperties {
  return {
    flex: 1,
    padding: '12px 8px',
    borderRadius: 14,
    border: `2px solid ${sel ? m.dot : '#e6eae4'}`,
    background: sel ? m.soft : '#fff',
    color: sel ? m.fg : '#8a94a0',
    fontWeight: 800,
    fontSize: 16,
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: 'all .12s',
  };
}

function tabStyle(active: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 22px',
    borderRadius: 14,
    border: 'none',
    cursor: 'pointer',
    fontSize: 16,
    fontWeight: active ? 800 : 700,
    fontFamily: 'inherit',
    background: active ? '#2fb457' : 'transparent',
    color: active ? '#fff' : '#7c8794',
    boxShadow: active ? '0 4px 12px rgba(47,180,87,.32)' : 'none',
  };
}

function undoStyle(enabled: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '11px 20px',
    borderRadius: 14,
    border: '2px solid #dfe6da',
    background: '#fff',
    color: '#5b6672',
    fontWeight: 700,
    fontSize: 16,
    fontFamily: 'inherit',
    cursor: 'pointer',
    opacity: enabled ? 1 : 0.4,
    pointerEvents: enabled ? 'auto' : 'none',
  };
}

const discardStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '11px 16px',
  borderRadius: 14,
  border: 'none',
  background: 'transparent',
  color: '#a7b0bb',
  fontWeight: 700,
  fontSize: 14,
  fontFamily: 'inherit',
  cursor: 'pointer',
};

function attnStyle(active: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '11px 20px',
    borderRadius: 14,
    border: 'none',
    cursor: 'pointer',
    fontSize: 16,
    fontWeight: 800,
    fontFamily: 'inherit',
    background: active ? '#2fb457' : '#fff',
    color: active ? '#fff' : '#5b6672',
    boxShadow: active ? '0 4px 12px rgba(47,180,87,.32)' : '0 2px 8px rgba(60,90,55,.08)',
  };
}

function fmtTimer(elapsed: number): string {
  const hh = Math.floor(elapsed / 3600);
  const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

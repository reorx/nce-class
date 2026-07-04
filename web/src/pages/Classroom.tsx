import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { GroupEditPopover } from '../components/GroupEditMenu';
import { Markdown } from '../components/Markdown';
import { useToast } from '../components/Toast';
import { ApiError, api, type ClassDetail, type TeacherItem } from '../lib/api';
import {
  applyStartTime,
  buildClassroomSession,
  buildCommitPayload,
  clearCommitBackup,
  clearSession,
  loadSession,
  newClientSessionId,
  nowSql,
  reducer,
  saveCommitBackup,
  saveSession,
  startTimeOf,
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
type View = 'board' | 'recite' | 'homework' | 'attendance' | 'regroup' | 'info';

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
  // 调组视图的组编辑菜单：点表头开/关（gid + 定位锚点）
  const [edit, setEdit] = useState<{ gid: string; el: HTMLElement } | null>(null);
  const [showEnd, setShowEnd] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const [discardPw, setDiscardPw] = useState('');
  const [discardErr, setDiscardErr] = useState('');
  const [discardVerifying, setDiscardVerifying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // 主讲老师 dropdown data (best-effort — the classroom itself stays offline-first)
  const [teachers, setTeachers] = useState<TeacherItem[]>([]);
  const [meId, setMeId] = useState('');
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

  // Same-org teachers + self, for the 主讲老师 dropdown in the info dialog.
  // A failed fetch just leaves the current choice as the only option.
  useEffect(() => {
    api
      .teachers()
      .then(setTeachers)
      .catch(() => {});
    api
      .me()
      .then((m) => setMeId(m.id))
      .catch(() => {});
  }, []);

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
  const changeGroupEmoji = (gid: string, emoji: string) => dispatch({ type: 'setGroupEmoji', gid, emoji });
  const renameGroup = (gid: string, name: string) => dispatch({ type: 'renameGroup', gid, name });
  const removeGroup = (gid: string) => dispatch({ type: 'removeGroup', gid });

  const goView = (v: View) => {
    setView(v);
    setOpenId(null);
    setOpenGid(null);
    setEdit(null);
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
    const payload = buildCommitPayload(session, nowSql());
    // Copy to the collision-free backup slot BEFORE the POST: a failed or
    // interrupted submit must never lose the lesson, even if a new session for
    // this class later overwrites nce.classroom.<classId>. Cleared only after
    // the server confirms; clientSessionId keeps any later re-POST idempotent.
    saveCommitBackup({ session, payload });
    api
      .commitSession(id, payload)
      .then(() => {
        clearCommitBackup(payload.clientSessionId);
        clearSession(id);
        toast('本节课已保存 · 已生成课堂回顾', 'success');
        nav(`/classes/${id}?tab=sessions`);
      })
      .catch((e) => {
        setSubmitting(false);
        toast(`${e instanceof ApiError ? e.message : '保存失败，请重试'}（课堂数据已在本机备份，不会丢失）`, 'error');
      });
  };

  // 放弃本节课: the only self-rescue for a broken local session (decision 12).
  // Gated on the teacher's own password so it can't be triggered casually.
  const openDiscard = () => {
    setDiscardPw('');
    setDiscardErr('');
    setDiscardVerifying(false);
    setShowDiscard(true);
  };
  const discard = () => {
    if (discardVerifying || !discardPw) return;
    setDiscardVerifying(true);
    setDiscardErr('');
    api
      .verifyPassword(discardPw)
      .then(() => {
        clearSession(id);
        nav(`/classes/${id}?tab=sessions`);
      })
      .catch((e) => {
        setDiscardVerifying(false);
        setDiscardErr(e instanceof ApiError && e.status === 403 ? '密码错误' : '验证失败，请重试');
      });
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
      {/* header — 左：课次(点击编辑课堂信息)；右：班级名 + 倒计时（弱化灰） */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '16px 26px 12px', gap: 14, flexShrink: 0 }}>
        <span style={{ fontSize: 28 }}>🏫</span>
        <span
          onClick={() => setShowInfo(true)}
          title="编辑课堂信息"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '4px 12px',
            margin: '-4px -12px',
            borderRadius: 12,
            fontWeight: 900,
            fontSize: 25,
            color: '#2c3340',
            cursor: 'pointer',
            transition: 'background .12s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.65)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          {lessonLabel}
          <span style={{ fontSize: 15, color: '#a3b39a' }}>✎</span>
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 18 }}>
          <span style={{ fontWeight: 800, fontSize: 18, color: '#a7b0bb' }}>{className}</span>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: overtime ? '#ff5a5f' : '#a7b0bb',
              fontWeight: 800,
              fontSize: 21,
            }}
          >
            <span style={{ fontSize: 18 }}>{overtime ? '⏰' : '⏱'}</span>
            <span style={{ fontFamily: NUM, letterSpacing: '.5px', fontVariantNumeric: 'tabular-nums' }}>
              {overtime ? `+${timerStr}` : timerStr}
            </span>
            {overtime && <span style={{ fontSize: 13, fontWeight: 800, opacity: 0.9 }}>超时</span>}
          </div>
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
                <span style={{ fontSize: 18 }}>✋</span>
                拖拽学生卡可在组间移动 · 点击表头可编辑小组（emoji / 组名 / 删除）·
                调组只影响后续加分归属，不改写历史组分
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
                      onClick={
                        view === 'regroup'
                          ? (e) => {
                              const el = e.currentTarget;
                              setEdit((cur) => (cur?.gid === g.id ? null : { gid: g.id, el }));
                            }
                          : () => setOpenGid(g.id)
                      }
                      title={view === 'regroup' ? '编辑小组' : undefined}
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

            {/* 未分组暂存区：删除组后成员落这里；调组视图可拖回小组 */}
            {(() => {
              const ungrouped = students.filter((s) => !s.g);
              if (view !== 'regroup' && !ungrouped.some((s) => s.attendance === 'present')) return null;
              return (
                <div
                  onDragOver={view === 'regroup' ? (e) => e.preventDefault() : undefined}
                  onDrop={
                    view === 'regroup'
                      ? (e) => {
                          e.preventDefault();
                          if (dragId.current != null) moveStudent(dragId.current, '');
                          dragId.current = null;
                        }
                      : undefined
                  }
                  style={{
                    margin: '10px 0 6px',
                    borderRadius: 18,
                    border: '2.5px dashed #d5ddce',
                    background: '#fafbf8',
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      fontWeight: 800,
                      fontSize: 15,
                      color: '#5b6672',
                    }}
                  >
                    <span style={{ fontSize: 17 }}>🚪</span>未分组
                    <span
                      style={{
                        padding: '2px 10px',
                        borderRadius: 10,
                        background: '#fff',
                        color: '#8a94a0',
                        fontSize: 13,
                      }}
                    >
                      {ungrouped.length}
                    </span>
                  </span>
                  {ungrouped.length === 0 && (
                    <span style={{ color: '#b7c0c9', fontSize: 13, fontWeight: 700 }}>
                      删除小组或把学生拖到这里后，成员显示在此处
                    </span>
                  )}
                  {ungrouped.map((s) => (
                    <div
                      key={s.id}
                      draggable={view === 'regroup'}
                      onDragStart={() => (dragId.current = s.id)}
                      onClick={view === 'board' && s.attendance === 'present' ? () => setOpenId(s.id) : undefined}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 12px 6px 6px',
                        borderRadius: 13,
                        background: '#fff',
                        border: '2px solid #e6eae4',
                        cursor: view === 'regroup' ? 'grab' : s.attendance === 'present' ? 'pointer' : 'default',
                        opacity: s.attendance === 'absent' ? 0.55 : 1,
                      }}
                    >
                      <div
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: '50%',
                          background: '#e3e7ec',
                          color: '#7c8794',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 800,
                          fontSize: 13,
                          flexShrink: 0,
                        }}
                      >
                        {s.name[0]}
                      </div>
                      <span style={{ fontWeight: 800, fontSize: 14, color: '#3a4350', whiteSpace: 'nowrap' }}>
                        {s.name}
                      </span>
                      {s.attendance === 'absent' ? (
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#a7b0bb' }}>未到</span>
                      ) : (
                        <span style={{ fontFamily: NUM, fontWeight: 800, fontSize: 14, color: '#8a94a0' }}>
                          ⭐{sScore(events, s.id)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* 调组视图的组编辑菜单 (emoji / 组名 / 删除) */}
        {edit &&
          (() => {
            const g = groups.find((x) => x.id === edit.gid);
            if (!g) return null;
            return (
              <GroupEditPopover
                anchor={edit.el}
                name={g.name}
                emoji={g.emoji}
                memberCount={students.filter((s) => s.g === g.id).length}
                canDelete={groups.length > 1}
                onEmoji={(em) => changeGroupEmoji(g.id, em)}
                onRename={(v) => renameGroup(g.id, v)}
                onDelete={() => {
                  removeGroup(g.id);
                  setEdit(null);
                }}
                onClose={() => setEdit(null)}
              />
            );
          })()}

        {view === 'info' && <ClassInfoView classId={id} session={session} />}

        {!isBoard && view !== 'info' && (
          <SegmentView
            view={view}
            students={students}
            groups={groups}
            colorOf={colorOf}
            onBadge={(sid) => (view === 'attendance' ? toggleAbsent(sid) : setOpenId(sid))}
            onMove={(sid, v) => (view === 'recite' ? setRecite(sid, v as Recitation) : setHomework(sid, v as Homework))}
          />
        )}
      </div>

      {/* dock */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 22px 18px', flexShrink: 0 }}>
        <button onClick={() => goView('attendance')} style={attnStyle(view === 'attendance')}>
          <span style={{ fontSize: 17 }}>📋</span>出勤
        </button>
        <button onClick={() => goView('info')} style={attnStyle(view === 'info')}>
          <span style={{ fontSize: 17 }}>📚</span>班级信息
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
          <button onClick={openDiscard} style={discardStyle}>
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

      {/* student popup — focused per view: board=score, recite/homework=status */}
      {openId != null &&
        (() => {
          const st = students.find((x) => x.id === openId);
          if (!st) return null;
          const g = groupById.get(st.g);
          const c = colorOf(st.g);
          const sc = sScore(events, st.id);
          const hint = sc >= 0 ? `本节 个人 +${sc} · 小组同步 +${sc}` : `本节 个人 ${sc} · 小组同步 ${sc}`;
          const close = () => setOpenId(null);
          return (
            <StudentPopup
              mode={view === 'recite' ? 'recite' : view === 'homework' ? 'homework' : 'score'}
              st={st}
              group={g ?? { id: st.g, name: '未分组', emoji: '🚪' }}
              ring={c.ring}
              score={sc}
              hint={hint}
              onScore={(d) => {
                addStudentScore(st.id, d);
                close();
              }}
              onRecite={(v) => {
                setRecite(st.id, v);
                close();
              }}
              onHomework={(v) => {
                setHomework(st.id, v);
                close();
              }}
              onClose={close}
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

      {/* mid-class lesson info edit (mirrors 课前配置's 本节课 card) */}
      {showInfo && (
        <LessonInfoDialog
          lessonNumber={session.lessonNumber ?? ''}
          lessonTitle={session.lessonTitle ?? ''}
          durationMin={session.plannedDurationMin}
          startedAt={session.startedAt}
          teacherId={session.teacherId ?? meId}
          teacherName={session.teacherName ?? ''}
          teachers={teachers}
          onSave={(v) => {
            dispatch({ type: 'setLessonInfo', ...v });
            setShowInfo(false);
          }}
          onClose={() => setShowInfo(false)}
        />
      )}

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
          onDiscard={() => {
            setShowEnd(false);
            openDiscard();
          }}
        />
      )}

      {/* discard confirmation */}
      {showDiscard && (
        <Overlay z={65} onClose={() => !discardVerifying && setShowDiscard(false)} strong>
          <div style={popupCard(440)} onClick={stop}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <span style={{ fontSize: 28 }}>⚠️</span>
              <span style={{ fontWeight: 900, fontSize: 22, color: '#2c3340' }}>放弃本节课？</span>
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#66756c', lineHeight: 1.6, marginBottom: 18 }}>
              本节课的加减分、背书 / 作业、出勤记录将全部丢弃且不会保存到后端。此操作不可撤销。
            </div>
            <input
              type="password"
              value={discardPw}
              autoFocus
              placeholder="输入你的登录密码以确认"
              onChange={(e) => {
                setDiscardPw(e.target.value);
                setDiscardErr('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && discard()}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '13px 16px',
                borderRadius: 14,
                border: `2px solid ${discardErr ? '#ff5a5f' : '#dfe6da'}`,
                fontSize: 16,
                fontWeight: 700,
                fontFamily: 'inherit',
                color: '#2c3340',
                outline: 'none',
                marginBottom: discardErr ? 8 : 22,
              }}
            />
            {discardErr && (
              <div style={{ color: '#ff5a5f', fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{discardErr}</div>
            )}
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={() => !discardVerifying && setShowDiscard(false)}
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
                disabled={!discardPw || discardVerifying}
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
                  cursor: !discardPw || discardVerifying ? 'not-allowed' : 'pointer',
                  opacity: !discardPw || discardVerifying ? 0.5 : 1,
                  boxShadow: '0 5px 14px rgba(255,90,95,.3)',
                }}
              >
                {discardVerifying ? '验证中…' : '放弃并退出'}
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
  value?: Recitation | Homework;
}

// ---- 班级信息 view: left = class/lesson facts, right = 班级资源 markdown ----
// Notes deliberately live on the server (not in the offline session snapshot),
// so this view fetches fresh on entry and saving needs the network.
function ClassInfoView({ classId, session }: { classId: string; session: ClassroomSession }) {
  const toast = useToast();
  const [detail, setDetail] = useState<ClassDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setFailed(false);
    api
      .classDetail(classId)
      .then(setDetail)
      .catch(() => setFailed(true));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [classId]);

  const save = () => {
    if (busy) return;
    setBusy(true);
    api
      .updateClassNotes(classId, draft)
      .then((d) => {
        setDetail(d);
        setEditing(false);
        toast('班级资源已保存');
      })
      .catch(() => toast('保存失败，请重试', 'error'))
      .finally(() => setBusy(false));
  };

  const startedHm = session.startedAt.slice(11, 16);
  const facts: [string, string][] = detail
    ? [
        ['班级', detail.name + (detail.level ? ` · ${detail.level}` : '')],
        ['负责老师', detail.teacherName],
        ['学生', `${detail.studentCount} 人`],
        ['默认分组', `${detail.groupCount} 组`],
        ['累计课次', `${detail.sessionCount} 节`],
      ]
    : [];
  const lessonFacts: [string, string][] = [
    ['课次', fmtLessonLabel({ lessonNumber: session.lessonNumber ?? '', lessonTitle: session.lessonTitle ?? '' })],
    ['主讲老师', session.teacherName || '—'],
    ['开始时间', startedHm],
    ['计划时长', `${session.plannedDurationMin} 分钟`],
  ];

  const factRow = ([label, value]: [string, string]) => (
    <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '7px 0' }}>
      <span style={{ width: 74, flexShrink: 0, fontSize: 14, fontWeight: 700, color: '#a7b0bb' }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 800, color: '#2c3340' }}>{value}</span>
    </div>
  );

  const paneBtn = (primary: boolean): CSSProperties => ({
    padding: '9px 20px',
    borderRadius: 12,
    border: primary ? 'none' : '2px solid #dfe6da',
    background: primary ? '#2fb457' : '#fff',
    color: primary ? '#fff' : '#5b6672',
    fontWeight: 800,
    fontSize: 15,
    fontFamily: 'inherit',
    cursor: 'pointer',
    boxShadow: primary ? '0 4px 12px rgba(47,180,87,.32)' : 'none',
    opacity: busy ? 0.6 : 1,
  });

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
        <span style={{ fontSize: 26 }}>📚</span>
        <span style={{ fontWeight: 900, fontSize: 22, color: '#2c3340' }}>班级信息</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          {editing ? (
            <>
              <button style={paneBtn(false)} onClick={() => setEditing(false)} disabled={busy}>
                取消
              </button>
              <button style={paneBtn(true)} onClick={save} disabled={busy}>
                {busy ? '保存中…' : '保存'}
              </button>
            </>
          ) : (
            <button
              style={paneBtn(false)}
              onClick={() => {
                setDraft(detail?.notes ?? '');
                setEditing(true);
              }}
              disabled={!detail}
            >
              ✎ 编辑资源
            </button>
          )}
        </div>
      </div>

      {failed ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 800, color: '#a7b0bb' }}>班级信息加载失败</div>
          <button style={paneBtn(false)} onClick={load}>
            重试
          </button>
        </div>
      ) : !detail ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            fontWeight: 800,
            color: '#a7b0bb',
          }}
        >
          加载中…
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div
            style={{
              width: 320,
              flexShrink: 0,
              padding: '18px 24px',
              borderRight: '2px solid #f0f3ed',
              overflow: 'auto',
            }}
          >
            {facts.map(factRow)}
            <div style={{ margin: '14px 0 8px', fontSize: 13, fontWeight: 900, color: '#a7b0bb', letterSpacing: 1 }}>
              本节课
            </div>
            {lessonFacts.map(factRow)}
          </div>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              padding: '18px 24px',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexShrink: 0 }}>
              <span style={{ fontSize: 16, fontWeight: 900, color: '#2c3340' }}>📖 班级资源</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#a7b0bb' }}>
                教材、链接、注意事项 · 支持 Markdown
              </span>
            </div>
            {editing ? (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={'# 教材\n\n- 《新概念英语》第二册\n- [单词表](https://…)'}
                autoFocus
                style={{
                  flex: 1,
                  minHeight: 0,
                  width: '100%',
                  padding: '12px 14px',
                  border: '2px solid #dfe6da',
                  borderRadius: 14,
                  background: '#fbfcf9',
                  color: '#2c3340',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 14,
                  lineHeight: 1.65,
                  resize: 'none',
                  outline: 'none',
                }}
              />
            ) : detail.notes ? (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 6 }}>
                <Markdown text={detail.notes} />
              </div>
            ) : (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 15,
                  fontWeight: 700,
                  color: '#a7b0bb',
                }}
              >
                还没有班级资源，点击右上角「编辑资源」添加
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SegmentView({
  view,
  students,
  groups,
  colorOf,
  onBadge,
  onMove,
}: {
  view: View;
  students: ClassroomStudent[];
  groups: SGroup[];
  colorOf: (gid: string) => (typeof GROUP_COLORS)[number];
  onBadge: (sid: string) => void;
  onMove?: (sid: string, value: Recitation | Homework) => void;
}) {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const dragSid = useRef<string | null>(null);
  const [overSeg, setOverSeg] = useState<string | null>(null);
  const canDrag = onMove != null && (view === 'recite' || view === 'homework');
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
      { title: '未检查', dot: '#c9cfd6', soft: '#f4f6f8', students: bucket((s) => s.r === null), value: null },
      { title: '已背完', dot: '#34c759', soft: '#eaf9ef', students: bucket((s) => s.r === '已背完'), value: '已背完' },
      {
        title: '背完部分',
        dot: '#ffb020',
        soft: '#fff6e0',
        students: bucket((s) => s.r === '背完部分'),
        value: '背完部分',
      },
      { title: '没背', dot: '#c9cfd6', soft: '#eef1f4', students: bucket((s) => s.r === '没背'), value: '没背' },
    ];
  } else if (view === 'homework') {
    const done = students.filter((s) => s.h !== null).length;
    icon = '📝';
    title = '作业检查';
    progress = `已批改 ${done} / ${total}`;
    segs = [
      { title: '未批改', dot: '#c9cfd6', soft: '#f4f6f8', students: bucket((s) => s.h === null), value: null },
      { title: '完成', dot: '#34c759', soft: '#eaf9ef', students: bucket((s) => s.h === '完成'), value: '完成' },
      { title: '没交', dot: '#c9cfd6', soft: '#eef1f4', students: bucket((s) => s.h === '没交'), value: '没交' },
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
        {canDrag && (
          <span style={{ fontWeight: 700, fontSize: 14, color: '#a7b0bb' }}>✋ 拖拽学生卡到目标状态栏可直接改状态</span>
        )}
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
          <div
            key={seg.title}
            onDragOver={
              canDrag
                ? (e) => {
                    e.preventDefault();
                    if (overSeg !== seg.title) setOverSeg(seg.title);
                  }
                : undefined
            }
            onDragLeave={
              canDrag
                ? (e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverSeg(null);
                  }
                : undefined
            }
            onDrop={
              canDrag
                ? (e) => {
                    e.preventDefault();
                    setOverSeg(null);
                    if (dragSid.current != null) onMove!(dragSid.current, seg.value ?? null);
                    dragSid.current = null;
                  }
                : undefined
            }
            style={{
              padding: '16px 10px',
              margin: '0 -10px',
              borderBottom: '1px solid #f2f5ef',
              borderRadius: 16,
              outline: overSeg === seg.title ? `2px dashed ${seg.dot}` : 'none',
              outlineOffset: -2,
              background: overSeg === seg.title ? seg.soft : 'transparent',
              transition: 'background .12s',
            }}
          >
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
                    draggable={canDrag}
                    onDragStart={canDrag ? () => (dragSid.current = s.id) : undefined}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 15px 8px 8px',
                      borderRadius: 16,
                      background: seg.soft,
                      border: '2px solid transparent',
                      cursor: canDrag ? 'grab' : 'pointer',
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
// Focused per view: 'score' (board) shows only ±1, 'recite'/'homework' show
// only that status picker. Every action commits immediately and the caller
// closes the popup — there is no "完成" button.

type PopupMode = 'score' | 'recite' | 'homework';

const RECITE_OPTIONS: { v: Recitation; label: string }[] = [
  { v: '已背完', label: '已背完' },
  { v: '背完部分', label: '背完部分' },
  { v: '没背', label: '没背' },
  { v: null, label: '未检查' },
];

const HOMEWORK_OPTIONS: { v: Homework; label: string }[] = [
  { v: '完成', label: '完成' },
  { v: '没交', label: '没交' },
  { v: null, label: '未检查' },
];

function StudentPopup({
  mode,
  st,
  group,
  ring,
  score,
  hint,
  onScore,
  onRecite,
  onHomework,
  onClose,
}: {
  mode: PopupMode;
  st: SStudent;
  group: SGroup;
  ring: string;
  score: number;
  hint: string;
  onScore: (d: 1 | -1) => void;
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

        {mode === 'score' && (
          <div style={{ background: '#f6f9f2', borderRadius: 20, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <button onClick={() => onScore(-1)} style={minusBtn}>
                −1
              </button>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontFamily: NUM, fontWeight: 800, fontSize: 44, lineHeight: 1, color: scoreColor }}>
                  {score > 0 ? `+${score}` : String(score)}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#98a2b0', marginTop: 3 }}>本节个人分</div>
              </div>
              <button onClick={() => onScore(1)} style={plusBtn}>
                +1
              </button>
            </div>
            <div style={{ textAlign: 'center', marginTop: 12, fontSize: 13, fontWeight: 700, color: '#8a94a0' }}>
              {hint}
            </div>
          </div>
        )}

        {mode === 'recite' && (
          <StatusOptions
            title="📖 背书检查"
            options={RECITE_OPTIONS}
            current={st.r}
            colorFor={(v) => (v ? RECITE_MAP[v] : GRAY)}
            onPick={onRecite}
          />
        )}

        {mode === 'homework' && (
          <StatusOptions
            title="📝 作业检查"
            options={HOMEWORK_OPTIONS}
            current={st.h}
            colorFor={(v) => (v ? HOMEWORK_MAP[v] : GRAY)}
            onPick={onHomework}
          />
        )}
      </div>
    </Overlay>
  );
}

function StatusOptions<V extends Recitation | Homework>({
  title,
  options,
  current,
  colorFor,
  onPick,
}: {
  title: string;
  options: { v: V; label: string }[];
  current: V;
  colorFor: (v: V) => { dot: string; soft: string; fg: string };
  onPick: (v: V) => void;
}) {
  return (
    <div>
      <div style={{ fontWeight: 800, fontSize: 15, color: '#5b6672', marginBottom: 9 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {options.map(({ v, label }) => {
          const sel = current === v;
          const m = colorFor(v);
          return (
            <button
              key={label}
              onClick={() => onPick(v)}
              style={{ ...optStyle(sel, m), display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}
            >
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: m.dot, flexShrink: 0 }} />
              <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
              {sel && <span style={{ fontSize: 13, fontWeight: 800 }}>当前 ✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ===== lesson info dialog ==================================================
// Mid-class edit of 本节课 info — same three fields as 课前配置's SessionInfoCard
// (课次号 / 课题 / 课堂时长). Saving only touches the local session; duration
// re-drives the header countdown off the unchanged startedAt.

function LessonInfoDialog({
  lessonNumber,
  lessonTitle,
  durationMin,
  startedAt,
  teacherId,
  teacherName,
  teachers,
  onSave,
  onClose,
}: {
  lessonNumber: string;
  lessonTitle: string;
  durationMin: number;
  startedAt: string;
  teacherId: string;
  teacherName: string;
  teachers: TeacherItem[];
  onSave: (v: {
    lessonNumber: string;
    lessonTitle: string;
    durationMin: number;
    teacherId?: string;
    teacherName?: string;
    startedAt?: string;
  }) => void;
  onClose: () => void;
}) {
  const [no, setNo] = useState(lessonNumber);
  const [title, setTitle] = useState(lessonTitle);
  const [duration, setDuration] = useState(String(durationMin));
  const [start, setStart] = useState(() => startTimeOf(startedAt));
  const [startErr, setStartErr] = useState('');
  const [tid, setTid] = useState(teacherId);
  const save = () => {
    // undefined keeps the session's current 开始时间 (cleared / invalid input)
    const nextStart = applyStartTime(startedAt, start) ?? undefined;
    // 'YYYY-MM-DD HH:mm:ss' compares lexicographically — a future start would
    // freeze the countdown at full duration and commit endedAt < startedAt
    if (nextStart && nextStart > nowSql()) {
      setStartErr('开始时间不能晚于当前时间');
      return;
    }
    onSave({
      lessonNumber: no.trim(),
      lessonTitle: title.trim(),
      durationMin: Math.max(1, Number(duration) || 120),
      startedAt: nextStart,
      // undefined keeps the session's current 主讲老师 (e.g. teachers 拉取失败)
      teacherId: tid || undefined,
      teacherName:
        teachers.find((t) => t.id === tid)?.name ?? (tid === teacherId ? teacherName || undefined : undefined),
    });
  };
  const onKey = (e: React.KeyboardEvent) => e.key === 'Enter' && save();
  return (
    <Overlay z={55} onClose={onClose}>
      <div style={popupCard(460)} onClick={stop}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <span style={{ fontSize: 26 }}>📘</span>
          <span style={{ fontWeight: 900, fontSize: 22, color: '#2c3340' }}>本节课</span>
          <span
            style={{
              fontWeight: 700,
              fontSize: 13,
              color: '#a7b0bb',
              background: '#f0f3ed',
              padding: '4px 11px',
              borderRadius: 10,
            }}
          >
            可选
          </span>
          <button onClick={onClose} style={closeBtn}>
            ✕
          </button>
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#98a2b0', marginBottom: 18 }}>
          填了会进入 recap 与成长档案；留空则以日期标识
        </div>

        <label style={fieldLabel}>课次号</label>
        <InfoField>
          <span style={{ fontWeight: 800, fontSize: 16, color: '#a7b0bb' }}>第</span>
          <input
            value={no}
            autoFocus
            onChange={(e) => setNo(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
            onKeyDown={onKey}
            placeholder="4"
            style={{ flex: 1, minWidth: 0, ...inputBase }}
          />
          <span style={{ fontWeight: 800, fontSize: 16, color: '#a7b0bb' }}>课</span>
        </InfoField>

        <label style={fieldLabel}>课题</label>
        <InfoField>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={onKey}
            placeholder="A private conversation"
            style={{ flex: 1, minWidth: 0, ...inputBase, fontSize: 16, fontWeight: 700 }}
          />
        </InfoField>

        <label style={fieldLabel}>开始时间</label>
        <InfoField>
          <span style={{ fontSize: 20 }}>🕒</span>
          <input
            type="time"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              setStartErr('');
            }}
            onKeyDown={onKey}
            style={{ flex: 1, minWidth: 0, width: '100%', ...inputBase, fontVariantNumeric: 'tabular-nums' }}
          />
        </InfoField>
        {startErr && (
          <div style={{ color: '#ff5a5f', fontSize: 13, fontWeight: 700, margin: '-10px 0 16px' }}>{startErr}</div>
        )}

        <label style={fieldLabel}>课堂时长</label>
        <InfoField last>
          <span style={{ fontSize: 20 }}>⏱</span>
          <input
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            onKeyDown={onKey}
            inputMode="numeric"
            placeholder="120"
            style={{ flex: 1, minWidth: 0, width: '100%', ...inputBase, fontVariantNumeric: 'tabular-nums' }}
          />
          <span style={{ fontWeight: 800, fontSize: 16, color: '#a7b0bb' }}>分钟</span>
        </InfoField>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#a7b0bb', marginTop: 8 }}>
          改开始时间或时长会重新计算右上角倒计时
        </div>

        <label style={{ ...fieldLabel, marginTop: 18 }}>主讲老师</label>
        <InfoField last>
          <span style={{ fontSize: 20 }}>🧑‍🏫</span>
          <select
            value={tid}
            onChange={(e) => setTid(e.target.value)}
            style={{ flex: 1, minWidth: 0, width: '100%', ...inputBase, fontSize: 16, cursor: 'pointer' }}
          >
            {!teachers.some((t) => t.id === tid) && <option value={tid}>{teacherName || '—'}</option>}
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </InfoField>

        <button onClick={save} style={{ ...doneBtn, marginTop: 20 }}>
          保存
        </button>
      </div>
    </Overlay>
  );
}

/** Rounded input wrapper — same focus-within highlight as 课前配置. */
function InfoField({ children, last }: { children: React.ReactNode; last?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 16px',
        borderRadius: 15,
        border: '2px solid #eaefe6',
        background: '#f8faf5',
        marginBottom: last ? 0 : 16,
        transition: 'border-color .12s,background .12s',
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = '#7fce97';
        e.currentTarget.style.background = '#fff';
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = '#eaefe6';
        e.currentTarget.style.background = '#f8faf5';
      }}
    >
      {children}
    </div>
  );
}

const fieldLabel: CSSProperties = {
  display: 'block',
  fontWeight: 800,
  fontSize: 14,
  color: '#5b6672',
  marginBottom: 8,
};

const inputBase: CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: '13px 0',
  fontSize: 17,
  fontWeight: 800,
  color: '#2c3340',
  fontFamily: 'inherit',
  outline: 'none',
};

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
  onDiscard,
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
  onDiscard: () => void;
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
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button
            onClick={onDiscard}
            disabled={submitting}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#a7b0bb',
              fontWeight: 600,
              fontSize: 13,
              fontFamily: 'inherit',
              cursor: submitting ? 'default' : 'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
              opacity: submitting ? 0.5 : 1,
            }}
          >
            丢弃本次上课，不计入记录
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

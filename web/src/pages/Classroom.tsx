import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { GroupEditPopover } from '../components/GroupEditMenu';
import { Markdown } from '../components/Markdown';
import { TagPicker } from '../components/TagPicker';
import { useToast } from '../components/Toast';
import { ApiError, api, type ClassDetail, type TeacherItem } from '../lib/api';
import { mergeTagOptions, tagKey } from '../lib/tags';
import {
  applyStartTime,
  buildClassroomSession,
  buildCommitPayload,
  buildEditSession,
  clearCommitBackup,
  clearSession,
  loadSession,
  newClientSessionId,
  nowSql,
  previewEndedAt,
  reducer,
  saveCommitBackup,
  saveSession,
  sqlFromParts,
  startTimeOf,
  type CAction,
  type ClassroomSession,
  type ClassroomStudent,
} from '../lib/classroomStore';
import { weekdayCN } from '../lib/attendance';
import { buildLogLines, type LogLine } from '../lib/classroomLog';
import { allSelected, dragTargets, someSelected, toggleAll, toggleOne } from '../lib/multiSelect';
import { lessonLabel as fmtLessonLabel } from '../lib/lesson';
import { HomeworkSidebar } from '../components/HomeworkSidebar';
import { PrevLessonContent } from '../components/PrevLessonContent';
import { configFromDetail } from '../lib/setup';
import { displayZoom } from '../lib/zoom';
import {
  GRAY,
  GROUP_COLORS,
  HOMEWORK_MAP,
  RECITE_MAP,
  byScoreDesc,
  gScore,
  gScoreBreakdown,
  sScore,
  type GroupScoreBreakdown,
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
type View = 'board' | 'recite' | 'homework' | 'attendance' | 'regroup' | 'info' | 'log';

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
  // 'loading' until we know whether to resume / boot / redirect (decision 13);
  // 'conflict' = 编辑 blocked because another in-progress session holds the slot.
  const [phase, setPhase] = useState<'loading' | 'ready' | 'redirect' | 'conflict'>('loading');
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
  // org 奖章 tag 库 (best-effort likewise; 离线时下拉只剩本节课新加的 tag)
  const [orgTags, setOrgTags] = useState<string[]>([]);
  const dragId = useRef<string | null>(null);
  // 投屏放大：>1440 宽（如 1920 投影）整体 zoom 等比放大（lib/zoom）
  const [zoom, setZoom] = useState(() => displayZoom(window.innerWidth));
  useEffect(() => {
    const onResize = () => setZoom(displayZoom(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ---- boot: resume from store · else edit_id / URL-param boot · else → 课前配置 -------
  useEffect(() => {
    const sp = new URLSearchParams(loc.search);
    const editId = sp.get('edit_id');
    const stored = loadSession(id);
    if (stored) {
      // The per-class slot holds at most one in-progress session. If we're asked
      // to edit a DIFFERENT one than what's stored, that's a conflict — block it
      // so we never clobber a live class (or another edit) mid-flight.
      if (editId && stored.editOfSessionId !== editId) {
        setPhase('conflict');
        return;
      }
      setSession(stored);
      setPhase('ready');
      return;
    }
    // 编辑上课记录: reopen a committed session by fetching its ledger + the class's
    // current default grouping, then rebuild the editable local session.
    if (editId) {
      Promise.all([api.sessionDetail(editId), api.classDetail(id)])
        .then(([detail, d]) => {
          if (detail.classId !== id) {
            setPhase('redirect');
            return;
          }
          const defaultGrouping = d.groups.map((g) => ({
            clientId: g.id,
            name: g.name,
            emoji: g.emoji,
            orderIndex: g.orderIndex,
            memberIds: g.memberIds,
          }));
          const fresh = buildEditSession(detail, defaultGrouping);
          saveSession(fresh);
          setSession(fresh);
          setPhase('ready');
        })
        .catch(() => setPhase('redirect'));
      return;
    }
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
    api
      .orgTags()
      .then((ts) => setOrgTags(ts.map((t) => t.name)))
      .catch(() => {});
  }, []);

  // 1s tick drives the countdown off the persisted startedAt (survives refresh).
  // 补录课堂 (backfill) isn't happening now — no ticking; the header shows a
  // static 补录 badge instead of a countdown, so skip the interval entirely.
  useEffect(() => {
    if (session?.backfill) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [session?.backfill]);

  const dispatch = (a: CAction) => setSession((s) => (s ? reducer(s, a) : s));

  if (phase === 'redirect') return <Navigate to={`/classes/${id}/setup`} replace />;
  if (phase === 'conflict') return <EditConflict classId={id} nav={nav} />;
  if (phase === 'loading' || !session) return <Splash />;

  const { students, groups, events } = session;
  const groupById = new Map(groups.map((g) => [g.id, g]));
  // 奖章下拉数据源 = 开课时 fetch 的 org 库 ∪ 本节课本地新加的
  const tagOptions = mergeTagOptions(
    orgTags,
    students.flatMap((s) => s.tags ?? []),
  );
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
  const undoEvent = (eventId: number) => dispatch({ type: 'undoEvent', eventId });
  const setRecite = (sid: string, v: Recitation) => dispatch({ type: 'setRecite', sid, v, at: nowSql() });
  const setHomework = (sid: string, v: Homework) => dispatch({ type: 'setHomework', sid, v, at: nowSql() });
  const setHomeworkContent = (content: string) => dispatch({ type: 'setHomeworkContent', content });
  const addTag = (sid: string, tag: string) => dispatch({ type: 'addTag', sid, tag });
  const removeTag = (sid: string, tag: string) => dispatch({ type: 'removeTag', sid, tag });
  const toggleAbsent = (sid: string) => dispatch({ type: 'toggleAttendance', sid, at: nowSql() });
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
  // 补录课堂：startedAt 在过去，实时倒计时会算出大幅「超时」——不 live 计时，
  // 右上角改渲染静态「补录」标签（见 header），这里的派生值 backfill 时不使用。
  const backfill = !!session.backfill;
  const elapsedSec = Math.max(0, Math.floor((nowMs - parseLocal(session.startedAt)) / 1000));
  const remainingSec = session.plannedDurationMin * 60 - elapsedSec;
  const overtime = !backfill && remainingSec < 0;
  const timerStr = fmtTimer(Math.abs(remainingSec));

  const className = session.className ?? '班级';
  const lessonLabel = fmtLessonLabel(session.lessonNumber, session.lessonTitle);
  const isBoard = view === 'board' || view === 'regroup';
  // 编辑上课记录 reuses the 补录 frozen-timer path but shows a distinct header badge.
  const pastBadge = session.editOfSessionId
    ? {
        title: '编辑上课记录：修改一节已保存的课，不实时计时',
        bg: '#e7f0ff',
        fg: '#2a6fb0',
        dot: '#a9c6ea',
        icon: '✏️',
        label: '编辑课堂',
      }
    : {
        title: '补录课堂：补充一节过去的课，不实时计时',
        bg: '#fff6e0',
        fg: '#b9791a',
        dot: '#d9b877',
        icon: '📝',
        label: '补录课堂',
      };

  // ---- end class: commit the whole session once, then to 上课记录 ----------
  const editId = session.editOfSessionId;
  const confirmEnd = () => {
    if (submitting) return;
    setSubmitting(true);
    // Live class ⇒ endedAt is the wall clock at 结束; 补录/编辑 use their fixed
    // preview time (single-sourced with the 结束确认 dialog).
    const endedAt = previewEndedAt(session) ?? nowSql();
    const payload = buildCommitPayload(session, endedAt);
    // Copy to the collision-free backup slot BEFORE the POST: a failed or
    // interrupted submit must never lose the lesson, even if a new session for
    // this class later overwrites nce.classroom.<classId>. Cleared only after
    // the server confirms; clientSessionId keeps any later re-POST idempotent.
    saveCommitBackup({ session, payload });
    // 编辑上课记录 overwrites the existing session in place; a normal 结束课堂 creates one.
    (editId ? api.overwriteSession(editId, payload) : api.commitSession(id, payload))
      .then((result) => {
        clearCommitBackup(payload.clientSessionId);
        clearSession(id);
        if (editId) {
          toast('本节课已更新', 'success');
          nav(`/classes/${id}/sessions/${editId}`);
        } else if (session.homeworkContent?.trim()) {
          // 课堂里已写好作业（随 commit 落库）→ 不再引导去作业 tab
          toast('本节课已保存 · 作业已布置', 'success');
          nav(`/classes/${id}/sessions/${result.sessionId}`);
        } else {
          toast('本节课已保存 · 请布置作业', 'success');
          // land on 作业布置 (overview is now the default tab); the toast nudges homework
          nav(`/classes/${id}/sessions/${result.sessionId}?tab=homework`);
        }
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
        zoom,
      }}
    >
      {/* header — 左：🏫班级名(进班级信息 view) · 课次(点击编辑课堂信息)；右：倒计时（弱化灰） */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '16px 26px 12px', gap: 14, flexShrink: 0 }}>
        <span
          onClick={() => goView('info')}
          title="班级信息"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
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
          <span style={{ fontSize: 28 }}>🏫</span>
          {className}
        </span>
        <span style={{ fontWeight: 900, fontSize: 22, color: '#a3b39a' }}>·</span>
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
          <button
            onClick={() => goView('log')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '6px 14px',
              borderRadius: 12,
              border: 'none',
              background: view === 'log' ? '#fff' : 'rgba(255,255,255,.65)',
              boxShadow: view === 'log' ? '0 4px 12px rgba(60,90,55,.14)' : 'none',
              color: '#5b6672',
              fontWeight: 800,
              fontSize: 15,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 15 }}>📜</span>
            日志
          </button>
          <PrevLessonButton classId={id} />
          {backfill ? (
            <div
              title={pastBadge.title}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 15px',
                borderRadius: 12,
                background: pastBadge.bg,
                color: pastBadge.fg,
                fontWeight: 800,
                fontSize: 16,
              }}
            >
              <span style={{ fontSize: 17 }}>{pastBadge.icon}</span>
              {pastBadge.label}
              <span style={{ color: pastBadge.dot }}>·</span>
              <span style={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>
                {dateLabelCn(session.startedAt)}
              </span>
            </div>
          ) : (
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
          )}
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
                const present = students.filter((s) => s.g === g.id && s.attendance === 'present');
                // 上课视图按个人分动态排序（高分在上）；调组视图保持花名册顺序方便拖拽
                const inGroup = view === 'board' ? byScoreDesc(present, events) : present;
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

        {view === 'log' && <LogView session={session} onUndo={undoEvent} />}

        {view === 'homework' ? (
          // 作业检查 + 右侧 30% 作业侧栏（上：上节课作业对照；下：本节课作业输入）
          <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 16 }}>
            <SegmentView
              key={view}
              view={view}
              students={students}
              groups={groups}
              colorOf={colorOf}
              onBadge={(sid) => setOpenId(sid)}
              onMove={(sids, v) => sids.forEach((sid) => setHomework(sid, v as Homework))}
            />
            <HomeworkSidebar
              classId={id}
              content={session.homeworkContent ?? ''}
              readOnly={!!session.editOfSessionId}
              onChange={setHomeworkContent}
            />
          </div>
        ) : (
          (view === 'recite' || view === 'attendance') && (
            // key=view：切视图整体重挂载，多选集/拖拽 ref/高亮一并归零
            <SegmentView
              key={view}
              view={view}
              students={students}
              groups={groups}
              colorOf={colorOf}
              onBadge={(sid) => (view === 'attendance' ? toggleAbsent(sid) : setOpenId(sid))}
              onMove={(sids, v) =>
                // 多选拖拽 = 逐个 dispatch：每人一条日志，同状态者由 reducer no-op 兜底
                sids.forEach((sid) => setRecite(sid, v as Recitation))
              }
            />
          )
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
            {editId ? '保存修改' : '结束课堂'}
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
              tagOptions={tagOptions}
              // 奖章可连续加/删，浮窗保持打开（唯一不 close() 的一组回调）
              onAddTag={(t) => addTag(st.id, t)}
              onRemoveTag={(t) => removeTag(st.id, t)}
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
          const close = () => setOpenGid(null);
          return (
            <GroupPopup
              group={g}
              headFg={c.headFg}
              breakdown={gScoreBreakdown(events, g.id)}
              onScore={(d) => {
                addGroupScore(g.id, d);
                close();
              }}
              onClose={close}
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
          backfill={backfill}
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

      {/* end-class confirmation (irreversible-commit review → confirm commits) */}
      {showEnd && (
        <EndConfirm
          className={className}
          lesson={lessonLabel}
          startedAt={session.startedAt}
          backfill={backfill}
          edit={!!editId}
          endedAt={previewEndedAt(session)}
          students={students}
          submitting={submitting}
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

// Shown when 编辑上课记录 is blocked: the per-class classroom slot already holds a
// live class (or a different session's edit). We never silently clobber it.
function EditConflict({ classId, nav }: { classId: string; nav: (to: string) => void }) {
  const btn: CSSProperties = {
    height: 46,
    padding: '0 22px',
    borderRadius: 14,
    fontWeight: 800,
    fontSize: 16,
    fontFamily: 'inherit',
    cursor: 'pointer',
  };
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#e9f3e4',
        fontFamily: FONT,
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 460,
          background: '#fff',
          borderRadius: 24,
          padding: '32px 30px',
          boxShadow: '0 12px 32px rgba(60,90,55,.12)',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 10 }}>✋</div>
        <div style={{ fontWeight: 900, fontSize: 21, color: '#2c3340', marginBottom: 10 }}>有正在进行的课堂</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#66756c', lineHeight: 1.7, marginBottom: 24 }}>
          这个班级还有一节未结束的课堂（或另一节课的编辑）。请先把它结束或放弃，再来编辑这节课。
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button
            onClick={() => nav(`/classes/${classId}`)}
            style={{ ...btn, background: '#fff', color: '#5b6672', border: '2px solid #e2e5ea' }}
          >
            返回班级
          </button>
          <button
            onClick={() => nav(`/classes/${classId}/classroom`)}
            style={{ ...btn, background: '#2fb457', color: '#fff', border: 'none' }}
          >
            去当前课堂 →
          </button>
        </div>
      </div>
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
  const h = HOMEWORK_MAP[s.h] ?? GRAY; // h 无 null 态；?? 兜住意外脏值

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
        {(s.tags?.length ?? 0) > 0 && <Badge text={`🏅${s.tags!.length}`} bg="#f5a623" />}
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

// ---- 上节课 popover: header button opens a downward card with the previous
// session's 日期/课次/作业 for quick reference. Content = shared PrevLessonContent
// (also used by 课前配置的「上节课回顾」卡); it fetches on mount, so the panel
// mounts lazily on first open and stays mounted (hidden) to cache for the lesson.
function PrevLessonButton({ classId }: { classId: string }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggle = () => {
    setOpen((cur) => !cur);
    setMounted(true);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        onClick={toggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '6px 14px',
          borderRadius: 12,
          border: 'none',
          background: open ? '#fff' : 'rgba(255,255,255,.65)',
          boxShadow: open ? '0 4px 12px rgba(60,90,55,.14)' : 'none',
          color: '#5b6672',
          fontWeight: 800,
          fontSize: 15,
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 15 }}>📖</span>
        上节课
      </button>
      {mounted && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 10px)',
            right: 0,
            width: 340,
            padding: '14px 18px',
            background: '#fff',
            borderRadius: 18,
            boxShadow: '0 14px 34px rgba(60,90,55,.2)',
            zIndex: 60,
            cursor: 'default',
            display: open ? undefined : 'none',
          }}
        >
          <PrevLessonContent classId={classId} />
        </div>
      )}
    </div>
  );
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
        ['班级', detail.name],
        ['负责老师', detail.teacherName],
        ['学生', `${detail.studentCount} 人`],
        ['默认分组', `${detail.groupCount} 组`],
        ['累计课次', `${detail.sessionCount} 节`],
      ]
    : [];
  const lessonFacts: [string, string][] = [
    ['课次', fmtLessonLabel(session.lessonNumber, session.lessonTitle)],
    ['主讲老师', session.teacherName || '—'],
    ['开始时间', session.backfill ? `${dateLabelCn(session.startedAt)} ${startedHm}` : startedHm],
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

// ---- 课堂日志 view: score events + status changes in one timeline ----------
// Score lines are undoable per-entry (deleting the event回退 personal & group
// score atomically); status lines are record-only. Newest first.
function LogView({ session, onUndo }: { session: ClassroomSession; onUndo: (eventId: number) => void }) {
  const lines = buildLogLines(session);
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
        <span style={{ fontSize: 26 }}>📜</span>
        <span style={{ fontWeight: 900, fontSize: 22, color: '#2c3340' }}>课堂日志</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: '#a7b0bb' }}>
          加减分可在这里撤销 · 个人分与小组分同步回退
        </span>
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
          共 {lines.length} 条
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: '6px 24px 18px', overflow: 'auto' }}>
        {lines.length === 0 && (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 15,
              fontWeight: 700,
              color: '#a7b0bb',
            }}
          >
            还没有课堂事件 · 加减分、背书 / 作业检查、出勤操作都会记录在这里
          </div>
        )}
        {lines.map((l) => (
          <LogRow key={l.id} line={l} onUndo={onUndo} />
        ))}
      </div>
    </div>
  );
}

function LogRow({ line: l, onUndo }: { line: LogLine; onUndo: (eventId: number) => void }) {
  const chip =
    l.tone === 'plus' ? { bg: '#e4f8ea', fg: '#1e9e4a' } : l.tone === 'minus' ? { bg: '#ffe4e4', fg: '#e0454a' } : null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '11px 10px',
        margin: '0 -10px',
        borderBottom: '1px solid #f2f5ef',
      }}
    >
      <span
        style={{
          fontFamily: NUM,
          fontVariantNumeric: 'tabular-nums',
          fontSize: 14,
          fontWeight: 700,
          color: '#a7b0bb',
          width: 72,
          flexShrink: 0,
        }}
      >
        {l.at.slice(11)}
      </span>
      <span style={{ fontSize: 18, flexShrink: 0 }}>{l.icon}</span>
      <span style={{ fontWeight: 800, fontSize: 16, color: '#2c3340', whiteSpace: 'nowrap' }}>{l.who}</span>
      {chip ? (
        <span
          style={{
            padding: '3px 11px',
            borderRadius: 10,
            background: chip.bg,
            color: chip.fg,
            fontFamily: NUM,
            fontWeight: 800,
            fontSize: 15,
            lineHeight: 1.3,
            flexShrink: 0,
          }}
        >
          {l.action}
        </span>
      ) : (
        <span style={{ fontWeight: 700, fontSize: 15, color: '#5b6672' }}>{l.action}</span>
      )}
      {l.detail && <span style={{ fontSize: 13, fontWeight: 700, color: '#a7b0bb' }}>{l.detail}</span>}
      {l.eventId != null && (
        <button
          onClick={() => onUndo(l.eventId!)}
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '6px 14px',
            borderRadius: 11,
            border: '2px solid #dfe6da',
            background: '#fff',
            color: '#5b6672',
            fontWeight: 700,
            fontSize: 13,
            fontFamily: 'inherit',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          ↩ 撤销
        </button>
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
  onMove?: (sids: string[], value: Recitation | Homework) => void;
}) {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const dragSids = useRef<string[]>([]);
  const [overSeg, setOverSeg] = useState<string | null>(null);
  // 多选批量改状态（lib/multiSelect）：选中集非空即多选模式——点学生卡=选中/
  // 取消，拖任一选中者=整批一起改状态。切视图时随 key=view 重挂载清空。
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const canDrag = onMove != null && (view === 'recite' || view === 'homework');
  const selecting = canDrag && selected.size > 0;
  // 背书/作业检查只针对到勤学生：出勤视图外，未到勤者不进花名册（改为未到勤即从检查列表移除）
  const roster = view === 'attendance' ? students : students.filter((s) => s.attendance === 'present');
  const total = roster.length;
  const bucket = (pred: (s: ClassroomStudent) => boolean) => roster.filter(pred);

  let icon = '',
    title = '',
    progress = '',
    segs: Seg[] = [];
  if (view === 'recite') {
    const done = roster.filter((s) => s.r !== null).length;
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
    // 没有「未批改」态：默认人人「没交」，交了拖去「完成」，交了但要补做拖去「需补」。
    const done = roster.filter((s) => s.h === '完成').length;
    const redo = roster.filter((s) => s.h === '需补').length;
    icon = '📝';
    title = '作业检查';
    progress = `完成 ${done} · 需补 ${redo}`;
    segs = [
      { title: '没交', dot: '#c9cfd6', soft: '#f4f6f8', students: bucket((s) => s.h === '没交'), value: '没交' },
      { title: '完成', dot: '#34c759', soft: '#eaf9ef', students: bucket((s) => s.h === '完成'), value: '完成' },
      { title: '需补', dot: '#ffb020', soft: '#fff6e0', students: bucket((s) => s.h === '需补'), value: '需补' },
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
          <span style={{ fontWeight: 700, fontSize: 14, color: '#a7b0bb' }}>
            {selecting ? '☑️ 点学生卡选中/取消 · 拖任一选中学生批量改状态' : '✋ 拖拽学生卡到目标状态栏可直接改状态'}
          </span>
        )}
        {selecting && (
          <button
            onClick={() => setSelected(new Set())}
            style={{
              padding: '6px 14px',
              borderRadius: 12,
              border: 'none',
              background: '#eef2ea',
              color: '#5b6672',
              fontWeight: 800,
              fontSize: 14,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            ✕ 取消选择（{selected.size}）
          </button>
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
                    const sids = dragSids.current;
                    dragSids.current = [];
                    if (!sids.length) return;
                    onMove!(sids, seg.value ?? null);
                    // 拖的是选中集 → 落下即完成批量改状态，清空选择退出多选；
                    // 单拖未选中者不碰选中集。
                    if (sids.some((x) => selected.has(x))) setSelected(new Set());
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
              {canDrag &&
                seg.students.length > 0 &&
                (() => {
                  const ids = seg.students.map((x) => x.id);
                  const all = allSelected(selected, ids);
                  return (
                    <label
                      style={{
                        marginLeft: 'auto',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 7,
                        cursor: 'pointer',
                        color: '#8a94a0',
                        fontWeight: 700,
                        fontSize: 14,
                      }}
                    >
                      全选
                      <SegCheckbox
                        checked={all}
                        indeterminate={!all && someSelected(selected, ids)}
                        onChange={() => setSelected(toggleAll(selected, ids))}
                      />
                    </label>
                  );
                })()}
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
                const isSel = selecting && selected.has(s.id);
                return (
                  <div
                    key={s.id}
                    onClick={() => (selecting ? setSelected(toggleOne(selected, s.id)) : onBadge(s.id))}
                    draggable={canDrag}
                    onDragStart={canDrag ? () => (dragSids.current = dragTargets(selected, s.id)) : undefined}
                    style={{
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 15px 8px 8px',
                      borderRadius: 16,
                      background: seg.soft,
                      border: `2px solid ${isSel ? seg.dot : 'transparent'}`,
                      cursor: canDrag ? 'grab' : 'pointer',
                      transition: 'transform .12s,border-color .12s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = seg.dot;
                      e.currentTarget.style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = isSel ? seg.dot : 'transparent';
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
                    {isSel && (
                      <span
                        style={{
                          position: 'absolute',
                          top: -7,
                          right: -7,
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          background: '#2fb457',
                          color: '#fff',
                          fontWeight: 900,
                          fontSize: 13,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 2px 6px rgba(0,0,0,.2)',
                        }}
                      >
                        ✓
                      </span>
                    )}
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

// 栏头全选 checkbox：原生 input 才有 indeterminate（部分选中）三态。
function SegCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      style={{ width: 20, height: 20, accentColor: '#2fb457', cursor: 'pointer' }}
    />
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
  { v: '没交', label: '没交' },
  { v: '完成', label: '完成' },
  { v: '需补', label: '需补' },
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
  tagOptions,
  onAddTag,
  onRemoveTag,
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
  tagOptions: string[];
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
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
          <>
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
            <TagsSection tags={st.tags ?? []} options={tagOptions} onAdd={onAddTag} onRemove={onRemoveTag} />
          </>
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
            colorFor={(v) => HOMEWORK_MAP[v]}
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

// 奖章区块（score mode 专用）：chips 带 ✕ 可删 + [+] 弹 TagPicker。加/删都
// 不关学生浮窗（可连续操作）；只有 TagPicker 自己在选中后关闭。
function TagsSection({
  tags,
  options,
  onAdd,
  onRemove,
}: {
  tags: string[];
  options: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}) {
  const [pickerEl, setPickerEl] = useState<HTMLElement | null>(null);
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontWeight: 800, fontSize: 15, color: '#5b6672', marginBottom: 9 }}>🏅 奖章</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {tags.map((t) => (
          <span
            key={t}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '7px 9px 7px 13px',
              borderRadius: 999,
              background: '#fff8e5',
              border: '1.5px solid #f2dfae',
              color: '#8f6b16',
              fontWeight: 800,
              fontSize: 14,
            }}
          >
            {t}
            <button
              onClick={() => onRemove(t)}
              title="移除奖章"
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                border: 'none',
                background: '#f2e4bb',
                color: '#8f6b16',
                fontSize: 11,
                fontWeight: 800,
                lineHeight: 1,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
              }}
            >
              ✕
            </button>
          </span>
        ))}
        <button
          onClick={(e) => setPickerEl(pickerEl ? null : e.currentTarget)}
          title="添加奖章"
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            border: '2px dashed #d8cfa8',
            background: pickerEl ? '#fff3d6' : '#fffdf6',
            color: '#b8891f',
            fontSize: 18,
            fontWeight: 800,
            lineHeight: 1,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          ＋
        </button>
      </div>
      {pickerEl && (
        <TagPicker
          anchor={pickerEl}
          options={options.filter((o) => !tags.some((t) => tagKey(t) === tagKey(o)))}
          onPick={(t) => {
            onAdd(t);
            setPickerEl(null);
          }}
          onClose={() => setPickerEl(null)}
        />
      )}
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
  backfill,
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
  backfill: boolean;
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
  // 补录课堂可改整个上课日期；实时课只改时分（applyStartTime 保留日期）
  const [dateStr, setDateStr] = useState(() =>
    /^\d{4}-\d{2}-\d{2}/.test(startedAt) ? startedAt.slice(0, 10) : nowSql().slice(0, 10),
  );
  const [start, setStart] = useState(() => startTimeOf(startedAt));
  const [startErr, setStartErr] = useState('');
  const [tid, setTid] = useState(teacherId);
  const save = () => {
    // 补录：从日期 + 时分重组 startedAt；实时课只换时分（undefined 保留原开始时间）
    const nextStart = backfill ? sqlFromParts(dateStr, start) : (applyStartTime(startedAt, start) ?? undefined);
    // 'YYYY-MM-DD HH:mm:ss' compares lexicographically — a future start would
    // freeze the countdown at full duration and commit endedAt < startedAt
    if (nextStart && nextStart > nowSql()) {
      setStartErr(backfill ? '上课时间不能设在未来' : '开始时间不能晚于当前时间');
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

        {backfill && (
          <>
            <label style={fieldLabel}>上课日期</label>
            <InfoField>
              <span style={{ fontSize: 20 }}>📅</span>
              <input
                type="date"
                value={dateStr}
                onChange={(e) => {
                  setDateStr(e.target.value);
                  setStartErr('');
                }}
                onKeyDown={onKey}
                style={{ flex: 1, minWidth: 0, width: '100%', ...inputBase, fontVariantNumeric: 'tabular-nums' }}
              />
            </InfoField>
          </>
        )}

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
          {backfill ? '补录课堂：结束时间 = 上课日期时间 + 时长' : '改开始时间或时长会重新计算右上角倒计时'}
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
// 与学生浮窗同一套交互：点 +1/−1 直接计分并关闭（连击去看板再点组头）。
// 下方明细把组总分拆成 组员个人加分累计 / 小组独立加分 / 扣分累计 三笔
// （口径见 lib/session 的 gScoreBreakdown，total = 前两笔之和 − 扣分）。
function GroupPopup({
  group,
  headFg,
  breakdown,
  onScore,
  onClose,
}: {
  group: SGroup;
  headFg: string;
  breakdown: GroupScoreBreakdown;
  onScore: (d: 1 | -1) => void;
  onClose: () => void;
}) {
  const { total, studentPlus, groupPlus, minus } = breakdown;
  const detailRow = (dot: string, label: string, note: string, value: string, valueColor: string) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '11px 16px',
        borderRadius: 14,
        background: '#f8f9fb',
      }}
    >
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: dot, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#2c3340' }}>{label}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#98a2b0', marginTop: 1 }}>{note}</div>
      </div>
      <span style={{ fontFamily: NUM, fontWeight: 800, fontSize: 22, color: valueColor }}>{value}</span>
    </div>
  );
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
            <button onClick={() => onScore(-1)} style={minusBtn}>
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
                {total}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#98a2b0', marginTop: 5 }}>本节小组总分</div>
            </div>
            <button onClick={() => onScore(1)} style={plusBtn}>
              +1
            </button>
          </div>
          <div style={{ textAlign: 'center', marginTop: 12, fontSize: 13, fontWeight: 700, color: '#8a94a0' }}>
            仅计入小组分，不影响任何学生的个人分
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#5b6672', marginBottom: 9 }}>📊 得分明细</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {detailRow(
              '#6fb1fc',
              '组员个人加分',
              '组内学生的个人 +1 同步累计',
              `+${studentPlus}`,
              studentPlus > 0 ? '#1e9e4a' : '#98a2b0',
            )}
            {detailRow(
              '#f5a623',
              '小组独立加分',
              '直接给小组的 +1，不进个人分',
              `+${groupPlus}`,
              groupPlus > 0 ? '#1e9e4a' : '#98a2b0',
            )}
            {detailRow(
              '#fb7a5c',
              '扣分累计',
              '组员个人与小组的 −1 合计',
              minus > 0 ? `−${minus}` : '0',
              minus > 0 ? '#e0454a' : '#98a2b0',
            )}
          </div>
        </div>
      </div>
    </Overlay>
  );
}

// ===== end-class confirmation ==============================================
// Not a recap preview — the recap lives on the session detail page after commit.
// This dialog warns that ending is irreversible and surfaces the facts worth a
// last look: 课次 / 开始时间 / 作业检查（作业无「未检查」态，默认即「没交」，
// 所以这里把在场且仍为没交的学生当作未检查名单提示老师）。
function EndConfirm({
  className,
  lesson,
  startedAt,
  backfill,
  edit,
  endedAt,
  students,
  submitting,
  onClose,
  onConfirm,
  onDiscard,
}: {
  className: string;
  lesson: string;
  startedAt: string;
  backfill: boolean;
  edit?: boolean;
  endedAt?: string;
  students: ClassroomStudent[];
  submitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  const unchecked = students.filter((s) => s.attendance === 'present' && s.h === '没交');
  const row = (label: string, value: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, padding: '9px 0' }}>
      <span style={{ width: 66, flexShrink: 0, fontSize: 14, fontWeight: 700, color: '#a7b0bb' }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 800, color: '#2c3340' }}>{value}</div>
    </div>
  );
  return (
    <Overlay z={60} onClose={() => !submitting && onClose()} strong>
      <div style={{ ...popupCard(500), maxHeight: '88vh', overflow: 'auto' }} onClick={stop}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <span style={{ fontSize: 28 }}>⚠️</span>
          <span style={{ fontWeight: 900, fontSize: 23, color: '#2c3340' }}>{edit ? '保存修改？' : '结束课堂？'}</span>
          <button onClick={onClose} style={{ ...closeBtn, marginLeft: 'auto' }}>
            ✕
          </button>
        </div>

        <div style={{ fontSize: 15, fontWeight: 600, color: '#5b6672', lineHeight: 1.7, marginBottom: 16 }}>
          {edit ? (
            <>
              保存后将<b style={{ color: '#e0454a' }}>覆盖</b>
              这节课已有的记录（得分、背书作业、出勤、奖章），原记录不可恢复。请确认以下信息无误：
            </>
          ) : (
            <>
              结束后本节课将整体存档入库、生成课堂战报，<b style={{ color: '#e0454a' }}>该操作不可撤销</b>
              。请确认以下信息无误：
            </>
          )}
        </div>

        {edit && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              borderRadius: 12,
              background: '#e7f0ff',
              color: '#2a6fb0',
              fontWeight: 700,
              fontSize: 13.5,
              lineHeight: 1.5,
              marginBottom: 14,
            }}
          >
            <span style={{ fontSize: 16 }}>✏️</span>
            正在编辑一节已保存的课 · 覆盖保存，不改动班级当前默认分组
          </div>
        )}

        {backfill && !edit && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              borderRadius: 12,
              background: '#fff6e0',
              color: '#b9791a',
              fontWeight: 700,
              fontSize: 13.5,
              lineHeight: 1.5,
              marginBottom: 14,
            }}
          >
            <span style={{ fontSize: 16 }}>📝</span>
            这是一节补录课堂 · 结束时间按「开始 + 时长」记录
          </div>
        )}

        <div
          style={{
            padding: '8px 18px',
            borderRadius: 16,
            background: '#f6f8f4',
            marginBottom: 20,
          }}
        >
          {row('班级', className)}
          {row('课次', lesson)}
          {row('开始时间', startedAt.slice(0, 16))}
          {backfill && endedAt && row('结束时间', endedAt.slice(0, 16))}
          {row(
            '作业检查',
            unchecked.length === 0 ? (
              <span style={{ color: '#1e9e4a' }}>已全部检查</span>
            ) : (
              <span style={{ color: '#b9791a' }}>
                {unchecked.length} 人未检查（没交）：{unchecked.map((s) => s.name).join('、')}
              </span>
            ),
          )}
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
            {submitting ? '保存中…' : edit ? '确认保存' : '确认结束'}
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
            {edit ? '放弃这次编辑（不改动已保存的记录）' : '丢弃本次上课，不计入记录'}
          </button>
        </div>
      </div>
    </Overlay>
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

/** '2026-07-03 14:00:00' → '7月3日 周四' — the 补录 header badge's date label
 *  (weekday via lib/attendance's single source of truth). */
function dateLabelCn(startedAt: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(startedAt);
  if (!m) return startedAt.slice(0, 10);
  const [, , mo, d] = m;
  return `${Number(mo)}月${Number(d)}日 ${weekdayCN(startedAt.slice(0, 10))}`;
}

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { GroupEditPopover } from '../components/GroupEditMenu';
import { PrevLessonContent } from '../components/PrevLessonContent';
import { api, type ClassDetail, type TeacherItem } from '../lib/api';
import {
  buildClassroomSession,
  loadSession,
  newClientSessionId,
  nowSql,
  saveSession,
  sqlFromParts,
} from '../lib/classroomStore';
import { GROUP_COLORS } from '../lib/session';
import {
  addGroup,
  buildSessionConfig,
  buildSetup,
  membersOf,
  moveStudent,
  removeGroup,
  renameGroup,
  setGroupEmoji,
  stagingMembers,
  sums,
  type SetupState,
} from '../lib/setup';

// 课前配置 · 开始课堂 (§7.2). Boots from the class's default grouping, lets the
// teacher set lesson info + micro-adjust groups, then freezes a session snapshot
// for the classroom. Faithful to nce-class-v1-design/课前配置.dc.html.
const FONT = "'Nunito','PingFang SC','Microsoft YaHei',system-ui,sans-serif";
const NUM = "'Baloo 2','Nunito','PingFang SC',sans-serif";
const TODAY = '2026年7月1日 · 周三'; // demo reference (server REFERENCE_TODAY = 2026-07-01)

const color = (ci: number) => GROUP_COLORS[ci % GROUP_COLORS.length];

export function Setup() {
  const { id = 'c1' } = useParams();
  const nav = useNavigate();
  // 补录课堂 (manual backfill): entered via `?backfill=1` from 上课记录. Unlocks a
  // date + start-time picker; the classroom then runs non-live (frozen timer) and
  // commits endedAt = startedAt + 时长 instead of the wall clock.
  const [params] = useSearchParams();
  const backfill = params.get('backfill') === '1';

  const [detail, setDetail] = useState<ClassDetail | null>(null);
  const [state, setState] = useState<SetupState | null>(null);
  const [lessonNo, setLessonNo] = useState('');
  const [lessonTitle, setLessonTitle] = useState('');
  const [durationMin, setDurationMin] = useState('120');
  // 补录：上课日期 + 开始时间，默认今天/此刻（普通实时课不显示、不使用）。
  const [dateStr, setDateStr] = useState(() => nowSql().slice(0, 10));
  const [timeStr, setTimeStr] = useState(() => nowSql().slice(11, 16));
  const [startErr, setStartErr] = useState('');
  // 主讲老师: all same-org teachers, defaulting to the logged-in one.
  const [teachers, setTeachers] = useState<TeacherItem[]>([]);
  const [teacherId, setTeacherId] = useState('');
  const [hoverZone, setHoverZone] = useState<string | null>(null);
  // 组编辑菜单：点表头开/关（gid + 定位锚点）
  const [edit, setEdit] = useState<{ gid: string; el: HTMLElement } | null>(null);
  const dragId = useRef<string | null>(null);

  useEffect(() => {
    // If a lesson is already in progress for this class, resume it rather than
    // silently overwriting it with a fresh session (M3 — e.g. teacher hits Back
    // to setup mid-class). 放弃本节课 in the classroom is the explicit reset.
    if (loadSession(id)) {
      nav(`/classes/${id}/classroom`, { replace: true });
      return;
    }
    api
      .classDetail(id)
      .then((d) => {
        setDetail(d);
        setState(buildSetup(d));
        setLessonNo(String((d.lastRecap?.lessonNumber ?? 0) + 1));
      })
      .catch(() => {});
    api
      .me()
      .then((me) => setTeacherId((cur) => cur || me.id))
      .catch(() => {});
    api
      .teachers()
      .then(setTeachers)
      .catch(() => {});
  }, [id, nav]);

  const s = sums(state ?? { groups: [], students: [], assign: {}, absent: {}, gidSeq: 1 });

  // ---- drag & drop --------------------------------------------------------
  const drop = (zone: string) => {
    const sid = dragId.current;
    dragId.current = null;
    setHoverZone(null);
    if (sid && state) setState(moveStudent(state, sid, zone));
  };
  const allowDrop = (e: React.DragEvent) => e.preventDefault();

  // 开始课堂: freeze the micro-adjusted grouping into a fresh local session and
  // persist it (offline-first, decision 3) — no backend request until 结束课堂.
  const start = () => {
    if (!state) return;
    const startedAt = backfill ? sqlFromParts(dateStr, timeStr) : nowSql();
    // 补录不能落在未来：手滑选错年份/时间会生成一条排在最前的假记录，污染
    // 上课记录/lastRecap/下一课次建议等按日期排序的视图。与课堂内编辑弹窗同一道校验。
    if (backfill && startedAt > nowSql()) {
      setStartErr('上课时间不能设在未来');
      return;
    }
    const config = buildSessionConfig(state, {
      lessonNumber: lessonNo.trim(),
      lessonTitle: lessonTitle.trim(),
      durationMin: Math.max(1, Number(durationMin) || 120),
      className: detail?.name,
      teacherId: teacherId || undefined,
      teacherName: teachers.find((t) => t.id === teacherId)?.name,
    });
    const session = buildClassroomSession(config, {
      classId: id,
      clientSessionId: newClientSessionId(),
      startedAt,
      backfill: backfill || undefined,
    });
    saveSession(session);
    nav(`/classes/${id}/classroom`);
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
      <div style={{ display: 'flex', alignItems: 'center', padding: '16px 30px 14px', gap: 16, flexShrink: 0 }}>
        <button onClick={() => nav('/')} style={backBtn}>
          <span style={{ fontSize: 18 }}>←</span>返回班级列表
        </button>
        <span style={{ fontSize: 28 }}>🏫</span>
        <span style={{ fontWeight: 900, fontSize: 25, color: '#2c3340' }}>{detail?.name ?? ' '}</span>
        <span style={{ color: '#b7c5ad', fontSize: 22, fontWeight: 800 }}>·</span>
        <span style={{ fontWeight: 700, fontSize: 19, color: '#66756c' }}>
          {detail?.students.filter((s) => s.status === 'active').length ?? 0} 名学生
        </span>
        {backfill ? (
          <span
            style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontWeight: 800,
              fontSize: 15,
              color: '#b9791a',
              background: '#fff6e0',
              padding: '8px 16px',
              borderRadius: 12,
            }}
          >
            <span style={{ fontSize: 17 }}>📝</span>补录课堂
          </span>
        ) : (
          <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 16, color: '#8a94a0' }}>{TODAY}</span>
        )}
      </div>

      {/* body */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 20, padding: '0 30px' }}>
        {/* left rail */}
        <div
          style={{
            width: 372,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            overflow: 'auto',
            paddingBottom: 4,
          }}
        >
          <SessionInfoCard
            backfill={backfill}
            dateStr={dateStr}
            timeStr={timeStr}
            startErr={startErr}
            onDate={(v) => {
              setDateStr(v);
              setStartErr('');
            }}
            onTime={(v) => {
              setTimeStr(v);
              setStartErr('');
            }}
            lessonNo={lessonNo}
            lessonTitle={lessonTitle}
            durationMin={durationMin}
            teachers={teachers}
            teacherId={teacherId}
            onLessonNo={setLessonNo}
            onLessonTitle={setLessonTitle}
            onDuration={(v) => setDurationMin(v.replace(/[^0-9]/g, '').slice(0, 3))}
            onTeacher={setTeacherId}
          />
          <LastRecapCard classId={id} />
        </div>

        {/* right: grouping */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
            borderRadius: 24,
            boxShadow: '0 10px 28px rgba(60,90,55,.08)',
            overflow: 'hidden',
          }}
        >
          {/* grouping header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '20px 24px 16px',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 22 }}>🧩</span>
            <span style={{ fontWeight: 900, fontSize: 20, color: '#2c3340' }}>分组方案</span>
            <button
              onClick={() => state && setState(addGroup(state))}
              style={addGroupBtn}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#7fce97';
                e.currentTarget.style.color = '#2fb457';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#cdd9c6';
                e.currentTarget.style.color = '#7c8794';
              }}
            >
              + 新建分组
            </button>
            <div
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '8px 15px',
                borderRadius: 12,
                background: '#fff6e0',
                color: '#b9791a',
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              <span style={{ fontSize: 15 }}>✋</span>拖拽学生卡在组间调整
            </div>
          </div>

          {/* group columns */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              gap: 14,
              padding: '4px 24px 8px',
              overflowX: 'auto',
            }}
          >
            {state?.groups.map((g) => {
              const c = color(g.ci);
              const members = membersOf(state, g.id);
              const hov = hoverZone === g.id;
              return (
                <div
                  key={g.id}
                  onDrop={() => drop(g.id)}
                  onDragOver={allowDrop}
                  onDragEnter={() => setHoverZone(g.id)}
                  style={{
                    width: 216,
                    flexShrink: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: 20,
                    border: `2.5px solid ${hov ? '#2fb457' : 'transparent'}`,
                    background: hov ? '#eefaf0' : '#f6f9f2',
                    overflow: 'hidden',
                    transition: 'border-color .12s,background .12s',
                  }}
                >
                  <div
                    onClick={(e) => {
                      const el = e.currentTarget;
                      setEdit((cur) => (cur?.gid === g.id ? null : { gid: g.id, el }));
                    }}
                    title="编辑小组"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '13px 14px',
                      background: c.headBg,
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontSize: 23, lineHeight: 1 }}>{g.emoji}</span>
                    <span
                      style={{
                        fontWeight: 900,
                        fontSize: 18,
                        color: c.headFg,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        minWidth: 0,
                      }}
                    >
                      {g.name}
                    </span>
                    <span
                      style={{
                        marginLeft: 'auto',
                        padding: '4px 11px',
                        borderRadius: 11,
                        background: 'rgba(255,255,255,.85)',
                        color: c.headFg,
                        fontFamily: NUM,
                        fontWeight: 800,
                        fontSize: 16,
                        flexShrink: 0,
                      }}
                    >
                      {members.length}
                    </span>
                  </div>
                  <div
                    style={{
                      flex: 1,
                      minHeight: 0,
                      padding: '12px 11px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 9,
                      overflow: 'auto',
                    }}
                  >
                    {members.map((m) => (
                      <div
                        key={m.id}
                        draggable
                        onDragStart={() => (dragId.current = m.id)}
                        onDragEnd={() => {
                          dragId.current = null;
                          setHoverZone(null);
                        }}
                        style={memberCard}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = '#c7e3bc';
                          e.currentTarget.style.transform = 'translateY(-1px)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = '#eef3e8';
                          e.currentTarget.style.transform = 'none';
                        }}
                      >
                        <div style={ringAvatar(38, c.ring)}>{m.name[0]}</div>
                        <span
                          style={{
                            fontWeight: 800,
                            fontSize: 16,
                            color: '#2c3340',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            minWidth: 0,
                          }}
                        >
                          {m.name}
                        </span>
                        <span style={{ marginLeft: 'auto', color: '#c4ccd4', fontSize: 16, flexShrink: 0 }}>⠿</span>
                      </div>
                    ))}
                    {members.length === 0 && (
                      <div
                        style={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          textAlign: 'center',
                          color: '#b7c0c9',
                          fontSize: 13,
                          fontWeight: 700,
                          padding: '14px 6px',
                          border: '2px dashed #e0e6da',
                          borderRadius: 14,
                        }}
                      >
                        把学生拖到这里
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* absent / ungrouped staging */}
          {state && (
            <StagingZone
              members={stagingMembers(state)}
              hover={hoverZone === 'absent'}
              onDrop={() => drop('absent')}
              onDragOver={allowDrop}
              onDragEnter={() => setHoverZone('absent')}
              onCardDragStart={(sid) => (dragId.current = sid)}
              onCardDragEnd={() => {
                dragId.current = null;
                setHoverZone(null);
              }}
            />
          )}

          {/* 组编辑菜单 (emoji / 组名 / 删除) — portaled, anchored to表头 */}
          {state &&
            edit &&
            (() => {
              const g = state.groups.find((x) => x.id === edit.gid);
              if (!g) return null;
              return (
                <GroupEditPopover
                  anchor={edit.el}
                  name={g.name}
                  emoji={g.emoji}
                  memberCount={membersOf(state, g.id).length}
                  canDelete={state.groups.length > 1}
                  onEmoji={(em) => setState((st) => (st ? setGroupEmoji(st, g.id, em) : st))}
                  onRename={(v) => setState((st) => (st ? renameGroup(st, g.id, v) : st))}
                  onDelete={() => {
                    setState((st) => (st ? removeGroup(st, g.id) : st));
                    setEdit(null);
                  }}
                  onClose={() => setEdit(null)}
                />
              );
            })()}
        </div>
      </div>

      {/* footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '14px 30px 18px', flexShrink: 0 }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 18, color: '#5b6672', fontWeight: 800, fontSize: 16 }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 18 }}>🧩</span>
            {s.groups} 组
          </span>
          <span style={{ color: '#d5ddce' }}>·</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 18 }}>⭐</span>
            {s.playing} 人参与计分
          </span>
          <span style={{ color: '#d5ddce' }}>·</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#a7b0bb' }}>
            <span style={{ fontSize: 17 }}>🚪</span>
            {s.absent} 人缺席
          </span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#a7b0bb', textAlign: 'right', lineHeight: 1.4 }}>
            调整后的分组会保存为
            <br />
            该班级默认分组
          </span>
          <button
            onClick={start}
            style={startBtn}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#28a04d')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#2fb457')}
          >
            开始课堂<span style={{ fontSize: 22 }}>→</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== session info card ===================================================
function SessionInfoCard({
  backfill,
  dateStr,
  timeStr,
  startErr,
  onDate,
  onTime,
  lessonNo,
  lessonTitle,
  durationMin,
  teachers,
  teacherId,
  onLessonNo,
  onLessonTitle,
  onDuration,
  onTeacher,
}: {
  backfill: boolean;
  dateStr: string;
  timeStr: string;
  startErr: string;
  onDate: (v: string) => void;
  onTime: (v: string) => void;
  lessonNo: string;
  lessonTitle: string;
  durationMin: string;
  teachers: TeacherItem[];
  teacherId: string;
  onLessonNo: (v: string) => void;
  onLessonTitle: (v: string) => void;
  onDuration: (v: string) => void;
  onTeacher: (v: string) => void;
}) {
  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 24,
        padding: '22px 22px 24px',
        boxShadow: '0 10px 28px rgba(60,90,55,.08)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
        <span style={{ fontSize: 22 }}>📘</span>
        <span style={{ fontWeight: 900, fontSize: 20, color: '#2c3340' }}>本节课</span>
        <span
          style={{
            marginLeft: 'auto',
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
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#98a2b0', marginBottom: 18 }}>
        {backfill ? '补录一节过去的课 · 设置上课日期与开始时间' : '填了会进入 recap 与成长档案；留空则以日期标识'}
      </div>

      {backfill && (
        <>
          <label style={fieldLabel}>上课日期</label>
          <Field>
            <span style={{ fontSize: 20 }}>📅</span>
            <input
              type="date"
              value={dateStr}
              max={nowSql().slice(0, 10)}
              onChange={(e) => onDate(e.target.value)}
              style={{ flex: 1, minWidth: 0, width: '100%', ...inputBase, fontVariantNumeric: 'tabular-nums' }}
            />
          </Field>

          <label style={fieldLabel}>开始时间</label>
          <Field>
            <span style={{ fontSize: 20 }}>🕒</span>
            <input
              type="time"
              value={timeStr}
              onChange={(e) => onTime(e.target.value)}
              style={{ flex: 1, minWidth: 0, width: '100%', ...inputBase, fontVariantNumeric: 'tabular-nums' }}
            />
          </Field>
          {startErr && (
            <div style={{ color: '#ff5a5f', fontSize: 13, fontWeight: 700, margin: '-10px 0 16px' }}>{startErr}</div>
          )}
        </>
      )}

      <label style={fieldLabel}>课次号</label>
      <Field>
        <span style={{ fontWeight: 800, fontSize: 16, color: '#a7b0bb' }}>第</span>
        <input
          value={lessonNo}
          onChange={(e) => onLessonNo(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
          placeholder="4"
          style={{ flex: 1, minWidth: 0, ...inputBase }}
        />
        <span style={{ fontWeight: 800, fontSize: 16, color: '#a7b0bb' }}>课</span>
      </Field>

      <label style={fieldLabel}>课题</label>
      <Field>
        <input
          value={lessonTitle}
          onChange={(e) => onLessonTitle(e.target.value)}
          placeholder="A private conversation"
          style={{ flex: 1, minWidth: 0, ...inputBase, fontSize: 16, fontWeight: 700 }}
        />
      </Field>

      <label style={fieldLabel}>课堂时长</label>
      <Field last>
        <span style={{ fontSize: 20 }}>⏱</span>
        <input
          value={durationMin}
          onChange={(e) => onDuration(e.target.value)}
          inputMode="numeric"
          placeholder="120"
          style={{ flex: 1, minWidth: 0, width: '100%', ...inputBase, fontVariantNumeric: 'tabular-nums' }}
        />
        <span style={{ fontWeight: 800, fontSize: 16, color: '#a7b0bb' }}>分钟</span>
      </Field>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#a7b0bb', marginTop: 8 }}>
        {backfill
          ? '结束时间 = 开始时间 + 时长（补录课堂不实时计时）'
          : '默认 120 分钟（2 小时）· 驱动课堂右上角倒计时'}
      </div>

      <label style={{ ...fieldLabel, marginTop: 18 }}>主讲老师</label>
      <Field last>
        <span style={{ fontSize: 20 }}>🧑‍🏫</span>
        <select
          value={teacherId}
          onChange={(e) => onTeacher(e.target.value)}
          style={{ flex: 1, minWidth: 0, width: '100%', ...inputBase, fontSize: 16, cursor: 'pointer' }}
        >
          {!teachers.some((t) => t.id === teacherId) && <option value={teacherId}>—</option>}
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#a7b0bb', marginTop: 8 }}>
        默认为当前登录老师 · 记入本节课记录
      </div>
    </div>
  );
}

/** Rounded input wrapper with the design's focus-within highlight. */
function Field({ children, last }: { children: React.ReactNode; last?: boolean }) {
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

// ===== last-class recap card ===============================================
// 内容体与课堂右上角「上节课」popover 共用 (components/PrevLessonContent)。
function LastRecapCard({ classId }: { classId: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 24, padding: 22, boxShadow: '0 10px 28px rgba(60,90,55,.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
        <span style={{ fontSize: 22 }}>📖</span>
        <span style={{ fontWeight: 900, fontSize: 20, color: '#2c3340' }}>上节课回顾</span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#a7b0bb', marginBottom: 10 }}>填本节课次 / 课题时可参考</div>
      <PrevLessonContent classId={classId} />
    </div>
  );
}

// ===== absent / ungrouped staging ==========================================
function StagingZone({
  members,
  hover,
  onDrop,
  onDragOver,
  onDragEnter,
  onCardDragStart,
  onCardDragEnd,
}: {
  members: { id: string; name: string }[];
  hover: boolean;
  onDrop: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnter: () => void;
  onCardDragStart: (sid: string) => void;
  onCardDragEnd: () => void;
}) {
  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      style={{
        margin: '6px 20px 18px',
        borderRadius: 18,
        border: `2.5px dashed ${hover ? '#2fb457' : '#d5ddce'}`,
        background: hover ? '#eefaf0' : '#fafbf8',
        padding: '14px 18px',
        transition: 'border-color .12s,background .12s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: members.length === 0 ? 0 : 13 }}>
        <span style={{ fontSize: 19 }}>🚪</span>
        <span style={{ fontWeight: 800, fontSize: 16, color: '#5b6672' }}>未分组 / 今日缺席</span>
        <span
          style={{
            padding: '3px 11px',
            borderRadius: 10,
            background: '#fff',
            color: '#8a94a0',
            fontWeight: 800,
            fontSize: 13,
          }}
        >
          {members.length}
        </span>
        <span style={{ marginLeft: 'auto', color: '#a7b0bb', fontSize: 13, fontWeight: 700 }}>
          留在此处的学生本节不计分
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {members.length === 0 && (
          <span style={{ color: '#b7c0c9', fontSize: 14, fontWeight: 700, padding: '2px 2px 4px' }}>
            🎉 全员就位 — 把缺席的同学拖到这里
          </span>
        )}
        {members.map((m) => (
          <div
            key={m.id}
            draggable
            onDragStart={() => onCardDragStart(m.id)}
            onDragEnd={onCardDragEnd}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '7px 13px 7px 7px',
              borderRadius: 14,
              background: '#fff',
              border: '2px solid #e6eae4',
              cursor: 'grab',
              opacity: 0.85,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#cdd9c6')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#e6eae4')}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: '#e3e7ec',
                color: '#98a2b0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: 14,
                flexShrink: 0,
              }}
            >
              {m.name[0]}
            </div>
            <span style={{ fontWeight: 800, fontSize: 15, color: '#7c8794', whiteSpace: 'nowrap' }}>{m.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===== style helpers =======================================================
function ringAvatar(size: number, ring: string): CSSProperties {
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
    fontSize: 16,
    flexShrink: 0,
    border: `2.5px solid ${ring}`,
  };
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
};

const backBtn: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  padding: '9px 16px',
  borderRadius: 14,
  border: 'none',
  background: '#fff',
  color: '#5b6672',
  fontWeight: 800,
  fontSize: 16,
  fontFamily: 'inherit',
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(60,90,55,.08)',
};

const addGroupBtn: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '10px 16px',
  borderRadius: 14,
  border: '2px dashed #cdd9c6',
  background: 'transparent',
  color: '#7c8794',
  fontWeight: 800,
  fontSize: 15,
  fontFamily: 'inherit',
  cursor: 'pointer',
  transition: 'border-color .12s,color .12s',
};

const memberCard: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 11,
  padding: '9px 12px',
  borderRadius: 15,
  background: '#fff',
  border: '2px solid #eef3e8',
  cursor: 'grab',
  boxShadow: '0 2px 7px rgba(60,90,55,.06)',
  transition: 'border-color .12s,transform .12s',
};

const startBtn: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '15px 40px',
  borderRadius: 18,
  border: 'none',
  background: '#2fb457',
  color: '#fff',
  fontWeight: 900,
  fontSize: 20,
  fontFamily: 'inherit',
  cursor: 'pointer',
  boxShadow: '0 8px 20px rgba(47,180,87,.36)',
};

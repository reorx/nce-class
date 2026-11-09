import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { AttendanceStatus, MakeupRecord } from '../api/attendance';
import { Modal } from '../components/Modal';
import { MakeupList } from '../components/MakeupList';
import { MakeupFormModal } from '../components/MakeupFormModal';
import { coverageMap } from '../lib/makeup';
import { LoadErrorBlock } from '../components/QueryState';
import {
  buildAttendanceCsv,
  classAttendanceStats,
  dateParts,
  rateColor,
  recordKey,
  rowCells,
  rowStats,
  rowTag,
  weekdayCN,
  type CellRecord,
} from '../lib/attendance';
import {
  AttendanceCellBusyError,
  useClassAttendanceQuery,
  usePendingAttendanceCells,
  useUpdateAttendanceMutation,
} from '../queries/attendance';

// 课堂界面 family (设计稿「历史出勤.dc.html」), not the IBM Plex management shell.
const FONT = "'Nunito','PingFang SC','Microsoft YaHei',system-ui,sans-serif";
const NUM = "'Baloo 2','Nunito','PingFang SC',sans-serif";
const RINGS = ['#f5a623', '#fb7a5c', '#6fb1fc', '#8c7ae6'];

const CSS = `
@keyframes att-tt-in{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes att-ov-in{from{opacity:0}to{opacity:1}}
@keyframes att-pop-in{from{transform:scale(.94) translateY(8px);opacity:0}to{transform:scale(1) translateY(0);opacity:1}}
.att-scroll::-webkit-scrollbar{width:11px;height:11px}
.att-scroll::-webkit-scrollbar-thumb{background:#cbd8c4;border-radius:11px;border:2px solid #fff}
.att-scroll::-webkit-scrollbar-track{background:transparent}
`;

const MARKS: Record<AttendanceStatus | 'off', { t: string; s: React.CSSProperties }> = {
  present: { t: '✓', s: { fontWeight: 800, fontSize: 21, color: '#2fb457', lineHeight: 1 } },
  absent: { t: '✕', s: { fontWeight: 800, fontSize: 18, color: '#e0454a', lineHeight: 1 } },
  leave: { t: '假', s: { fontWeight: 800, fontSize: 16, color: '#e0912a', lineHeight: 1 } },
  off: { t: '·', s: { fontSize: 14, color: '#c2cabb', lineHeight: 1 } },
};

const STATUS_CN: Record<AttendanceStatus, string> = { present: '出勤', absent: '缺勤', leave: '请假' };

const STATUS_DEFS: { k: AttendanceStatus; ic: string; label: string; c: string; bg: string }[] = [
  { k: 'present', ic: '✓', label: '到勤', c: '#2fb457', bg: '#e4f8ea' },
  { k: 'absent', ic: '✕', label: '缺勤', c: '#e0454a', bg: '#ffe4e4' },
  { k: 'leave', ic: '假', label: '请假', c: '#e0912a', bg: '#fff3d9' },
];

const LEGEND = [
  { ic: '✓', t: '到勤', c: '#2fb457' },
  { ic: '✕', t: '缺勤', c: '#e0454a' },
  { ic: '假', t: '请假', c: '#e0912a' },
  { ic: '✓', t: '补课抵扣（计入出勤）', c: '#2a75be' },
];

type HistEntry = { sessionId: string; studentId: string; prev: CellRecord };

// 考勤表：数据来自 useClassAttendanceQuery（服务端确认的记录 + 进行中修改的 pending overlay），
// 不再自存一份 records。即时反馈、单格回滚由 overlay 保证：失败只让那一格回到服务端值，
// 其他格（含并行进行中的）不受影响，整表重取也覆盖不了 pending 格。
// 撤销历史只收录服务端确认成功的修改；撤销本身也是一次写入，失败时保留记录可重试。
export function ClassAttendance() {
  const { id = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const makeupView = search.get('view') === 'makeups';
  const [makeupForm, setMakeupForm] = useState<{ initial?: { studentId: string; sessionId: string }; editing?: MakeupRecord } | null>(null);
  const [confirmPresent, setConfirmPresent] = useState<{ r: number; c: number; makeup: MakeupRecord } | null>(null);
  const attendanceQuery = useClassAttendanceQuery(id);
  const data = attendanceQuery.data;
  const pendingCells = usePendingAttendanceCells(id);
  const update = useUpdateAttendanceMutation();
  const [hist, setHist] = useState<HistEntry[]>([]);
  const [hoverR, setHoverR] = useState<number | null>(null);
  const [hoverC, setHoverC] = useState<number | null>(null);
  const [open, setOpen] = useState<{ r: number; c: number } | null>(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const recs = useMemo(
    () =>
      new Map<string, CellRecord>(
        (data?.records ?? []).map((r) => [recordKey(r.sessionId, r.studentId), { status: r.status }]),
      ),
    [data],
  );

  const showToast = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  };

  const write = (sessionId: string, studentId: string, next: CellRecord) =>
    update.mutateAsync({ classId: id, sessionId, studentId, input: { status: next.status } });

  /** 改一格：成功后才进入撤销历史。同格正在保存时页面已禁用入口，这里只兜底提示。 */
  const applyRec = async (sessionId: string, studentId: string, next: CellRecord, prev: CellRecord) => {
    try {
      await write(sessionId, studentId, next);
      setHist((h) => [...h, { sessionId, studentId, prev }]);
    } catch (e) {
      showToast(e instanceof AttendanceCellBusyError ? e.message : '保存失败，请重试');
    }
  };

  const coverage = useMemo(() => coverageMap(data?.makeups ?? []), [data?.makeups]);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.students.map((st, i) => {
      const cells = rowCells(st.id, data.sessions, recs, coverage);
      const stats = rowStats(cells);
      return { st, i, cells, stats, tag: rowTag(st.status, cells), ring: RINGS[i % RINGS.length] };
    });
  }, [data, recs, coverage]);

  const totals = useMemo(() => classAttendanceStats(rows.map((r) => r.stats)), [rows]);

  if (!data) {
    return (
      <div style={{ minHeight: '100vh', background: '#e9f3e4', fontFamily: FONT }}>
        {attendanceQuery.isError ? (
          <LoadErrorBlock error={attendanceQuery.error} what="考勤" onRetry={attendanceQuery.refetch} />
        ) : (
          <div style={{ padding: '40px 32px', color: '#8a94a0', fontWeight: 700 }}>加载中…</div>
        )}
      </div>
    );
  }

  const { sessions, students } = data;
  const cellOf = (r: number, c: number): CellRecord | null =>
    recs.get(recordKey(sessions[c].id, students[r].id)) ?? null;
  const cellBusy = (r: number, c: number) => pendingCells.has(recordKey(sessions[c].id, students[r].id));

  const setStatus = (r: number, c: number, k: AttendanceStatus) => {
    const cur = cellOf(r, c);
    if (!cur || cur.status === k || cellBusy(r, c)) return;
    const makeup = coverage.get(recordKey(sessions[c].id, students[r].id));
    if (k === 'present' && makeup) {
      setConfirmPresent({ r, c, makeup });
      return;
    }
    void applyRec(sessions[c].id, students[r].id, { status: k }, cur);
  };

  const lastEntry = hist[hist.length - 1];
  const undoBusy = lastEntry != null && pendingCells.has(recordKey(lastEntry.sessionId, lastEntry.studentId));

  const undo = async () => {
    const last = lastEntry;
    if (!last || undoBusy) return;
    try {
      await write(last.sessionId, last.studentId, last.prev);
      setHist((h) => h.filter((x) => x !== last));
    } catch (e) {
      showToast(e instanceof AttendanceCellBusyError ? e.message : '撤销失败，请重试');
    }
  };

  const doExport = () => {
    const live = {
      ...data,
      records: [...recs].map(([k, v]) => {
        const [sessionId, studentId] = k.split(':');
        return { sessionId, studentId, ...v };
      }),
    };
    const blob = new Blob(['﻿' + buildAttendanceCsv(live)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${data.className}-考勤.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('考勤表已导出为 CSV');
  };

  const fmtMD = (date: string) => `${dateParts(date).mm}/${dateParts(date).dd}`;
  const range = sessions.length ? `${fmtMD(sessions[0].date)} – ${fmtMD(sessions[sessions.length - 1].date)}` : '';

  const popup = open
    ? { st: students[open.r], sess: sessions[open.c], rec: cellOf(open.r, open.c), busy: cellBusy(open.r, open.c), makeup: rows[open.r].cells[open.c].makeup }
    : null;

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#e9f3e4',
        color: '#2c3340',
        fontFamily: FONT,
      }}
    >
      <style>{CSS}</style>

      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '15px 26px 11px', gap: 13, flexShrink: 0 }}>
        <Link
          to="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '9px 15px',
            borderRadius: 13,
            background: '#fff',
            color: '#5b6672',
            fontWeight: 800,
            fontSize: 15,
            textDecoration: 'none',
            boxShadow: '0 2px 8px rgba(60,90,55,.08)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#f6f9f2')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
        >
          <span style={{ fontSize: 17 }}>←</span>返回
        </Link>
        <span style={{ fontSize: 25 }}>🏫</span>
        <span style={{ fontWeight: 900, fontSize: 23 }}>{data.className}</span>
        <span style={{ color: '#b7c5ad', fontSize: 20, fontWeight: 800 }}>·</span>
        <span style={{ fontWeight: 800, fontSize: 19, color: '#66756c' }}>考勤</span>
        <div className="att-view-tabs" aria-label="考勤视图">
          <button aria-pressed={!makeupView} onClick={() => setSearch((p) => { const next = new URLSearchParams(p); next.delete('view'); return next; })}>出勤表</button>
          <button aria-pressed={makeupView} onClick={() => setSearch((p) => { const next = new URLSearchParams(p); next.set('view', 'makeups'); return next; })}>补课记录</button>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button
            onClick={doExport}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '10px 17px',
              borderRadius: 13,
              border: 'none',
              background: '#2fb457',
              color: '#fff',
              fontWeight: 800,
              fontSize: 15,
              fontFamily: 'inherit',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(47,180,87,.28)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#28a04d')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#2fb457')}
          >
            <span style={{ fontSize: 15 }}>⬇</span>导出
          </button>
        </div>
      </div>

      {attendanceQuery.isError && <LoadErrorBlock error={attendanceQuery.error} what="考勤" onRetry={attendanceQuery.refetch} />}
      {makeupView ? <MakeupList data={data} onCreate={() => setMakeupForm({})} onEdit={(editing) => setMakeupForm({ editing })} /> : <>
      {/* info strip */}
      <div
        style={{
          flexShrink: 0,
          margin: '2px 26px 0',
          padding: '11px 18px',
          borderRadius: 14,
          background: '#fff',
          border: '1.5px solid #e8efe1',
          display: 'flex',
          alignItems: 'center',
          gap: 13,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontWeight: 900, fontSize: 17, lineHeight: 1 }}>上课记录</span>
        <span style={{ color: '#cfd8c6', fontWeight: 700 }}>·</span>
        <span style={{ fontWeight: 700, fontSize: 15, color: '#5b6672', lineHeight: 1 }}>
          共 {sessions.length} 次课
        </span>
        {range && (
          <>
            <span style={{ color: '#cfd8c6', fontWeight: 700 }}>·</span>
            <span style={{ fontWeight: 700, fontSize: 15, color: '#5b6672', lineHeight: 1 }}>{range}</span>
          </>
        )}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            fontWeight: 800,
            fontSize: 14,
            color: '#8a94a0',
          }}
        >
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#2fb457' }} />
            已上 {sessions.length} 次
          </span>
        </div>
      </div>

      {/* hint bar */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 11, padding: '13px 26px 11px' }}>
        <span
          style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 700, color: '#8a94a0' }}
        >
          <span style={{ fontSize: 15 }}>💡</span>点击任意格子可更正出勤记录或登记补课
        </span>
        <div style={{ marginLeft: 'auto' }}>
          <button
            onClick={undo}
            disabled={!lastEntry || undoBusy}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '9px 16px',
              borderRadius: 12,
              border: '2px solid #dfe6da',
              background: '#fff',
              color: '#5b6672',
              fontWeight: 800,
              fontSize: 15,
              fontFamily: 'inherit',
              cursor: 'pointer',
              ...(lastEntry && !undoBusy ? {} : { opacity: 0.4, pointerEvents: 'none' as const }),
            }}
          >
            <span style={{ fontSize: 15 }}>↩</span>撤销
          </button>
        </div>
      </div>

      {/* the grid */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          margin: '2px 26px 4px',
          background: '#fff',
          borderRadius: 20,
          boxShadow: '0 10px 28px rgba(60,90,55,.08)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {sessions.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              color: '#9aa1ac',
            }}
          >
            <div style={{ fontSize: 34 }}>🗓️</div>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#5b6672' }}>还没有上课记录</div>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>上完第一节课后，这里会出现全班考勤表</div>
          </div>
        ) : (
          <div
            className="att-scroll"
            onMouseLeave={() => {
              setHoverR(null);
              setHoverC(null);
            }}
            style={{ flex: 1, minHeight: 0, overflow: 'auto' }}
          >
            <div style={{ minWidth: '100%', width: 'max-content' }}>
              {/* header row */}
              <div style={{ display: 'flex' }}>
                <div
                  style={{
                    flex: '0 0 44px',
                    boxSizing: 'border-box',
                    minHeight: 60,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                    fontSize: 13,
                    color: '#a7b0bb',
                    position: 'sticky',
                    top: 0,
                    left: 0,
                    zIndex: 40,
                    background: '#fff',
                    borderRight: '1px solid #e4ebe0',
                    borderBottom: '2px solid #d7e2cf',
                  }}
                >
                  #
                </div>
                <div
                  style={{
                    flex: '0 0 158px',
                    boxSizing: 'border-box',
                    minHeight: 60,
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 11px',
                    fontWeight: 800,
                    fontSize: 15,
                    color: '#5b6672',
                    position: 'sticky',
                    top: 0,
                    left: 44,
                    zIndex: 40,
                    background: '#fff',
                    borderRight: '2px solid #e4ebe0',
                    borderBottom: '2px solid #d7e2cf',
                  }}
                >
                  学生
                </div>
                {sessions.map((s, c) => (
                  <div
                    key={s.id}
                    onMouseEnter={() => {
                      setHoverR(null);
                      setHoverC(c);
                    }}
                    title={
                      s.lessonNumber != null
                        ? `第 ${s.lessonNumber} 课${s.lessonTitle ? ` · ${s.lessonTitle}` : ''}`
                        : undefined
                    }
                    style={{
                      flex: '0 0 54px',
                      boxSizing: 'border-box',
                      minHeight: 60,
                      padding: '7px 2px 6px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      gap: 2,
                      borderRight: '1px solid #e4ebe0',
                      borderBottom: '2px solid #d7e2cf',
                      position: 'sticky',
                      top: 0,
                      zIndex: 30,
                      background: hoverC === c ? '#eef7ea' : '#fff',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 1, lineHeight: 1 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#98a2b0' }}>{dateParts(s.date).mm}/</span>
                      <span style={{ fontFamily: NUM, fontSize: 19, fontWeight: 800, color: '#2c3340' }}>
                        {dateParts(s.date).dd}
                      </span>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#b3bcac' }}>{weekdayCN(s.date)}</span>
                  </div>
                ))}
                <div
                  style={{
                    flex: '0 0 122px',
                    boxSizing: 'border-box',
                    minHeight: 60,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                    fontSize: 14,
                    color: '#5b6672',
                    position: 'sticky',
                    top: 0,
                    zIndex: 30,
                    background: '#fff',
                    borderLeft: '2px solid #e4ebe0',
                    borderBottom: '2px solid #d7e2cf',
                  }}
                >
                  出勤率
                </div>
              </div>

              {/* body rows */}
              {rows.map(({ st, cells, stats, tag, ring }, r) => {
                const rowHover = hoverR === r;
                const pctColor = rateColor(stats.rate);
                const suspended = st.status === 'suspended';
                return (
                  <div key={st.id} style={{ display: 'flex' }}>
                    <div
                      onMouseEnter={() => {
                        setHoverR(r);
                        setHoverC(null);
                      }}
                      style={{
                        flex: '0 0 44px',
                        boxSizing: 'border-box',
                        height: 46,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: NUM,
                        fontWeight: 700,
                        fontSize: 14,
                        color: '#a7b0bb',
                        borderRight: '1px solid #e4ebe0',
                        borderBottom: '1px solid #e4ebe0',
                        position: 'sticky',
                        left: 0,
                        zIndex: 20,
                        background: rowHover ? '#f3f8ef' : '#fff',
                      }}
                    >
                      {r + 1}
                    </div>
                    <div
                      onMouseEnter={() => {
                        setHoverR(r);
                        setHoverC(null);
                      }}
                      style={{
                        flex: '0 0 158px',
                        boxSizing: 'border-box',
                        height: 46,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 9,
                        padding: '0 11px',
                        borderRight: '2px solid #e4ebe0',
                        borderBottom: '1px solid #e4ebe0',
                        position: 'sticky',
                        left: 44,
                        zIndex: 20,
                        background: rowHover ? '#f3f8ef' : '#fff',
                      }}
                    >
                      <div
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: '50%',
                          background: '#dbe1e8',
                          color: '#7c8794',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 800,
                          fontSize: 13,
                          flexShrink: 0,
                          border: `2px solid ${ring}`,
                        }}
                      >
                        {st.name[0]}
                      </div>
                      <span
                        style={{
                          fontWeight: 800,
                          fontSize: 15,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          minWidth: 0,
                          color: suspended ? '#9aa1ac' : '#2c3340',
                          textDecoration: suspended ? 'line-through' : undefined,
                        }}
                      >
                        {st.name}
                      </span>
                      {tag && (
                        <span
                          style={{
                            flexShrink: 0,
                            padding: '2px 6px',
                            borderRadius: 7,
                            fontSize: 10,
                            fontWeight: 800,
                            lineHeight: 1.5,
                            background: tag === '停课' ? '#eef1ee' : '#fff3d9',
                            color: tag === '停课' ? '#9aa1ac' : '#c0850f',
                          }}
                        >
                          {tag}
                        </span>
                      )}
                    </div>
                    {cells.map((cell, c) => {
                      const off = cell.status == null;
                      const md = !!cell.makeup;
                      let bg = '#ffffff';
                      if (off) bg = '#f1f3ef';
                      if (md) bg = '#eef5fc';
                      if (!off) {
                        const rc = hoverR === r,
                          ch = hoverC === c;
                        if (rc && ch) bg = '#e7f4e3';
                        else if (rc || ch) bg = md ? '#e6eefb' : '#f3f8ef';
                      }
                      const mi = md ? { t: '✓', s: { ...MARKS.present.s, color: '#2a75be' } } : MARKS[cell.status ?? 'off'];
                      const dl = fmtMD(sessions[c].date);
                      const title = `${dl} · ${off ? '未在班' : STATUS_CN[cell.status as AttendanceStatus]}${cell.makeup ? `（已补课 · ${fmtMD(cell.makeup.date)} ${cell.makeup.durationMinutes == null ? '未记录时长' : `补 ${cell.makeup.durationMinutes} 分钟`}）` : ''}`;
                      return (
                        <div
                          key={sessions[c].id}
                          onClick={() => setOpen({ r, c })}
                          role="button"
                          tabIndex={0}
                          aria-label={`${st.name} ${title}`}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen({ r, c }); } }}
                          onMouseEnter={() => {
                            setHoverR(r);
                            setHoverC(c);
                          }}
                          title={title}
                          style={{
                            flex: '0 0 54px',
                            boxSizing: 'border-box',
                            height: 46,
                            position: 'relative',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRight: '1px solid #e4ebe0',
                            borderBottom: '1px solid #e4ebe0',
                            userSelect: 'none',
                            transition: 'background .1s',
                            background: bg,
                            cursor: 'pointer',
                          }}
                        >
                          <span style={mi.s}>{mi.t}</span>
                          {md && (
                            <span
                              style={{
                                position: 'absolute',
                                top: 1,
                                right: 2,
                                fontSize: 9.5,
                                fontWeight: 800,
                                color: '#2a75be',
                                lineHeight: 1,
                              }}
                            >
                              补
                            </span>
                          )}
                        </div>
                      );
                    })}
                    <div
                      title={
                        stats.rate == null
                          ? '未在班'
                          : `出勤率 ${stats.rate}% · 实到 ${stats.pres}/${stats.sched} · 缺勤 ${stats.absent} · 请假 ${stats.leave} · 补课 ${stats.madeUp}`
                      }
                      style={{
                        flex: '0 0 122px',
                        boxSizing: 'border-box',
                        height: 46,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '0 12px',
                        borderLeft: '2px solid #e4ebe0',
                        borderBottom: '1px solid #e4ebe0',
                        background: rowHover ? '#f6faf3' : '#fff',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'stretch',
                          gap: 3,
                          width: '100%',
                          lineHeight: 1,
                        }}
                      >
                        <div
                          style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 4 }}
                        >
                          <span style={{ fontFamily: NUM, fontWeight: 800, fontSize: 17, color: pctColor }}>
                            {stats.rate == null ? '—' : `${stats.rate}%`}
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#a7b0bb' }}>
                            {stats.sched ? `${stats.pres}/${stats.sched}` : '—'}
                          </span>
                        </div>
                        <div
                          style={{
                            width: '100%',
                            height: 5,
                            borderRadius: 3,
                            background: '#eef1ec',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${stats.rate ?? 0}%`,
                              background: pctColor,
                              borderRadius: 3,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* footer: legend + class stats */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 18, padding: '8px 28px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          {LEGEND.map((lg) => (
            <span
              key={lg.t}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#66756c' }}
            >
              <span style={{ color: lg.c, fontWeight: 900, fontSize: 15, position: 'relative', paddingRight: lg.t.startsWith('补课') ? 8 : 0 }}>{lg.ic}{lg.t.startsWith('补课') && <sup style={{ position: 'absolute', right: 0, top: -4, fontSize: 8 }}>补</sup>}</span>
              {lg.t}
            </span>
          ))}
        </div>
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            fontWeight: 800,
            fontSize: 14,
            color: '#5b6672',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 15 }}>📊</span>全班平均出勤{' '}
            <span style={{ fontFamily: NUM, color: '#2fb457', fontSize: 18 }}>{totals.avg}%</span>
          </span>
          <span style={{ color: '#d5ddce' }}>·</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 15 }}>🏅</span>满勤{' '}
            <span style={{ fontFamily: NUM, color: '#2c3340', fontSize: 18 }}>{totals.full}</span> 人
          </span>
        </div>
      </div>

      </>}

      {popup && <Modal open title={`${popup.st.name} · ${fmtMD(popup.sess.date)} ${weekdayCN(popup.sess.date)}`} onClose={() => setOpen(null)} width={450}>
        <div className="makeup-form">
          {popup.rec ? <>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>出勤状态{popup.busy ? ' · 保存中…' : ''}</div>
            <div style={{ display: 'flex', gap: 9, marginBottom: 22 }}>
              {STATUS_DEFS.map((sd) => <button key={sd.k} disabled={popup.busy} onClick={() => setStatus(open!.r, open!.c, sd.k)} style={{ flex: 1, padding: '13px 6px', border: `2px solid ${popup.rec!.status === sd.k ? sd.c : '#e6eae4'}`, background: popup.rec!.status === sd.k ? sd.bg : '#fff', borderRadius: 12 }}>{sd.ic} {sd.label}</button>)}
            </div>
          </> : <p>该生当天未在班</p>}
          <div style={{ fontWeight: 800, marginBottom: 10 }}>补课</div>
          {popup.rec?.status === 'present' ? <p className="makeup-hint">已到勤，无需补课</p> : popup.makeup ? <div className="makeup-hint">
            <p style={{ marginTop: 0 }}>已通过 {fmtMD(popup.makeup.date)} 补课抵扣 · {popup.makeup.durationMinutes == null ? '未记录时长' : `${popup.makeup.durationMinutes} 分钟`}</p>
            <button onClick={() => { setMakeupForm({ editing: popup.makeup! }); setOpen(null); }}>查看补课记录</button>
          </div> : <div className="makeup-hint"><button onClick={() => { setMakeupForm({ initial: { studentId: popup.st.id, sessionId: popup.sess.id } }); setOpen(null); }}>登记补课</button></div>}
          <div className="makeup-actions"><button className="makeup-primary" onClick={() => setOpen(null)}>完成</button></div>
        </div>
      </Modal>}

      {confirmPresent && <Modal open title="解除补课抵扣" onClose={() => setConfirmPresent(null)}>
        <div className="makeup-form"><p>这节已通过 {fmtMD(confirmPresent.makeup.date)} 补课抵扣，改为到勤将解除抵扣，确定吗？</p>
          <div className="makeup-actions"><button onClick={() => setConfirmPresent(null)}>取消</button><button className="makeup-primary" onClick={() => {
            const { r, c } = confirmPresent;
            const prev = cellOf(r, c);
            setConfirmPresent(null);
            if (prev && !cellBusy(r, c)) void applyRec(sessions[c].id, students[r].id, { status: 'present' }, prev);
          }}>确认改为到勤</button></div>
        </div>
      </Modal>}

      {makeupForm && <MakeupFormModal data={data} initial={makeupForm.initial} editing={makeupForm.editing} onClose={() => setMakeupForm(null)} />}

      {toast && (
        <div
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 26,
            transform: 'translate(-50%,0)',
            zIndex: 210,
            background: '#1e2a20',
            color: '#fff',
            padding: '11px 20px',
            borderRadius: 12,
            fontSize: 14,
            fontWeight: 700,
            boxShadow: '0 10px 28px rgba(15,30,15,.3)',
            animation: 'att-tt-in .18s ease',
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

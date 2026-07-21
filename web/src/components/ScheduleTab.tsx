import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type ScheduleItem } from '../lib/api';
import { weekdayCN } from '../lib/attendance';
import {
  addBrush,
  brushIndexOf,
  canSave,
  initEditor,
  isValidBrush,
  lessonsOn,
  monthGrid,
  monthLabel,
  nextMonth,
  prevMonth,
  removeLesson,
  selectBrush,
  setName,
  sortedLessons,
  toggleDay,
  toPayload,
  type EditorState,
} from '../lib/scheduleEditor';
import { GREEN } from '../lib/theme';
import { Modal } from './Modal';
import { useToast } from './Toast';

// 时间刷配色：按刷子下标取色（mockup：蓝 / 橙 起步）。
const BRUSH_COLORS = ['#4f6ef7', '#e8913a', '#2fb457', '#9b59b6', '#0aa2c0', '#d94a4a'];
export const brushColor = (i: number) =>
  BRUSH_COLORS[((i % BRUSH_COLORS.length) + BRUSH_COLORS.length) % BRUSH_COLORS.length];

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const md = (d: string) => d.slice(5); // YYYY-MM-DD → MM-DD

export function ScheduleTab({ classId }: { classId: string }) {
  const toast = useToast();
  const [schedules, setSchedules] = useState<ScheduleItem[] | null>(null);
  // list 视图，或编辑器（editingId = null 表示新建）
  const [editor, setEditor] = useState<{ state: EditorState; editingId: string | null } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ScheduleItem | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () =>
    api
      .listSchedules(classId)
      .then(setSchedules)
      .catch(() => toast('排班列表加载失败', 'error'));

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  async function openEditor(item: ScheduleItem | null) {
    if (!item) {
      setEditor({ state: initEditor({ today: todayStr() }), editingId: null });
      return;
    }
    try {
      const d = await api.scheduleDetail(item.id);
      setEditor({
        state: initEditor({
          name: d.name,
          lessons: d.lessons.map((l) => ({ date: l.date, startTime: l.startTime, endTime: l.endTime })),
          today: todayStr(),
        }),
        editingId: d.id,
      });
    } catch {
      toast('课程周期加载失败', 'error');
    }
  }

  async function save(state: EditorState, editingId: string | null) {
    if (busy || !canSave(state)) return;
    setBusy(true);
    try {
      if (editingId) await api.updateSchedule(editingId, toPayload(state));
      else await api.createSchedule(classId, toPayload(state));
      await reload();
      setEditor(null);
      toast(editingId ? '课程周期已保存' : '课程周期已创建');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '保存失败，请重试', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || busy) return;
    setBusy(true);
    try {
      await api.deleteSchedule(pendingDelete.id);
      await reload();
      toast(`已删除「${pendingDelete.name}」`);
      setPendingDelete(null);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '删除失败，请重试', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (editor) {
    return (
      <ScheduleEditor
        state={editor.state}
        setState={(s) => setEditor({ ...editor, state: s })}
        editing={editor.editingId != null}
        busy={busy}
        onCancel={() => setEditor(null)}
        onSave={() => save(editor.state, editor.editingId)}
      />
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#1e2430' }}>课程周期（排班表）</div>
          <div style={{ fontSize: 12.5, color: '#7a828f', marginTop: 3 }}>
            日历点选排课，一个周期对应一次收费；收款在顶部「收银台」按周期发起。
          </div>
        </div>
        <button
          onClick={() => openEditor(null)}
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
          <span style={{ fontSize: 16, fontWeight: 400, lineHeight: 1 }}>+</span>新建课程周期
        </button>
      </div>

      {schedules && schedules.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '56px 20px',
            color: '#9aa1ac',
            fontSize: 13.5,
            background: '#fff',
            border: '1px dashed #d3d9df',
            borderRadius: 14,
          }}
        >
          还没有课程周期，点右上角「新建课程周期」用日历排课
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(schedules ?? []).map((s) => (
          <div
            key={s.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              background: '#fff',
              border: '1px solid #e7e9ee',
              borderRadius: 12,
              padding: '14px 18px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#1e2430' }}>{s.name}</div>
              <div className="mono" style={{ fontSize: 12.5, color: '#7a828f', marginTop: 4 }}>
                {s.minDate && s.maxDate ? `${md(s.minDate)} ~ ${md(s.maxDate)}` : '—'} · {s.lessonCount} 节
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
              {s.batchId ? (
                <Link
                  to={`/billing/${s.batchId}`}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#2c7a48',
                    background: '#e9f5ee',
                    padding: '4px 11px',
                    borderRadius: 999,
                    textDecoration: 'none',
                  }}
                >
                  已生成收款批次 →
                </Link>
              ) : (
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#7a828f',
                    background: '#f0f2f5',
                    padding: '4px 11px',
                    borderRadius: 999,
                  }}
                >
                  未生成收款批次
                </span>
              )}
              <button style={smallGhostBtn} onClick={() => openEditor(s)}>
                ✎ 编辑
              </button>
              <button
                style={{ ...smallGhostBtn, color: '#d94a4a' }}
                title={s.batchId ? '需先删除收款批次' : '删除课程周期'}
                onClick={() => setPendingDelete(s)}
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={!!pendingDelete} onClose={() => setPendingDelete(null)} title="删除课程周期">
        <div style={{ fontSize: 14, color: '#3c4451', lineHeight: 1.7 }}>
          确定删除「<b>{pendingDelete?.name}</b>」（{pendingDelete?.lessonCount} 节）吗？
          {pendingDelete?.batchId && (
            <div style={{ color: '#b06c22', marginTop: 6 }}>该周期已生成收款批次，需先在收银台删除批次。</div>
          )}
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

// ===== 日历编辑器 ===========================================================
function ScheduleEditor({
  state,
  setState,
  editing,
  busy,
  onCancel,
  onSave,
}: {
  state: EditorState;
  setState: (s: EditorState) => void;
  editing: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');
  const [addingBrush, setAddingBrush] = useState(false);
  const cells = monthGrid(state.month);
  const active = state.brushes[state.activeBrush];

  function submitBrush() {
    const brush = { startTime: newStart, endTime: newEnd };
    if (!isValidBrush(brush)) return;
    setState(addBrush(state, brush));
    setNewStart('');
    setNewEnd('');
    setAddingBrush(false);
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e7e9ee', borderRadius: 14, padding: '18px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: '#1e2430' }}>
          {editing ? '编辑课程周期' : '新建课程周期'}
        </div>
        <div style={{ fontSize: 12.5, color: '#7a828f' }}>先选时间刷，再点日历日期排课；再点同一天取消</div>
        <button style={{ ...smallGhostBtn, marginLeft: 'auto' }} onClick={onCancel}>
          返回列表
        </button>
      </div>

      <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 420 }}>
          {/* 时间刷 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              marginBottom: 16,
              padding: '10px 14px',
              background: 'rgba(79,110,247,.05)',
              border: '1px solid rgba(79,110,247,.22)',
              borderRadius: 10,
            }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#5b6472' }}>时间刷</span>
            {state.brushes.map((b, i) => {
              const on = i === state.activeBrush;
              const color = brushColor(i);
              return (
                <button
                  key={`${b.startTime}-${b.endTime}`}
                  onClick={() => setState(selectBrush(state, i))}
                  className="mono"
                  style={{
                    padding: '4px 12px',
                    borderRadius: 999,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: on ? color : 'transparent',
                    color: on ? '#fff' : color,
                    border: on ? `1.5px solid ${color}` : `1.5px dashed ${color}`,
                  }}
                >
                  {b.startTime}–{b.endTime}
                  {on ? ' ✓' : ''}
                </button>
              );
            })}
            {addingBrush ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)} style={timeInput} />
                <span style={{ color: '#9aa1ac' }}>–</span>
                <input type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} style={timeInput} />
                <button
                  style={{
                    ...smallGhostBtn,
                    color: isValidBrush({ startTime: newStart, endTime: newEnd }) ? '#2c7a48' : '#aab1bc',
                  }}
                  onClick={submitBrush}
                >
                  添加
                </button>
                <button style={{ ...smallGhostBtn, color: '#9aa1ac' }} onClick={() => setAddingBrush(false)}>
                  ×
                </button>
              </span>
            ) : (
              <button
                onClick={() => setAddingBrush(true)}
                style={{
                  padding: '4px 12px',
                  borderRadius: 999,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: 'transparent',
                  color: '#8a929e',
                  border: '1.5px dashed #c8cdd6',
                }}
              >
                ＋ 新时间段
              </button>
            )}
            {active && (
              <span style={{ marginLeft: 'auto', fontSize: 12, color: '#8a929e' }}>
                当前刷子{' '}
                <span className="mono" style={{ color: brushColor(state.activeBrush), fontWeight: 700 }}>
                  {active.startTime}–{active.endTime}
                </span>
              </span>
            )}
          </div>

          {/* 月历 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <button style={smallGhostBtn} onClick={() => setState(prevMonth(state))}>
              ‹
            </button>
            <strong style={{ fontSize: 15 }}>{monthLabel(state.month)}</strong>
            <button style={smallGhostBtn} onClick={() => setState(nextMonth(state))}>
              ›
            </button>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7,1fr)',
              gap: 4,
              textAlign: 'center',
              fontSize: 12,
              color: '#9aa1ac',
              marginBottom: 4,
            }}
          >
            {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
            {cells.map((c) => {
              const dayLessons = lessonsOn(state, c.date);
              const painted = dayLessons.length > 0;
              const firstIdx = painted ? brushIndexOf(state, dayLessons[0]) : -1;
              const color = firstIdx >= 0 ? brushColor(firstIdx) : '#8a929e';
              return (
                <button
                  key={c.date}
                  data-date={c.date}
                  onClick={() => setState(toggleDay(state, c.date))}
                  style={{
                    minHeight: 52,
                    padding: '5px 2px',
                    textAlign: 'center',
                    border: painted ? `1.5px solid ${color}` : '1.5px solid transparent',
                    background: painted ? `${color}1f` : 'transparent',
                    borderRadius: 8,
                    opacity: c.inMonth ? 1 : 0.3,
                    cursor: 'pointer',
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: '#1e2430',
                  }}
                >
                  {c.day}
                  {dayLessons.map((l) => {
                    const idx = brushIndexOf(state, l);
                    return (
                      <div
                        key={l.startTime}
                        className="mono"
                        style={{
                          fontSize: 9.5,
                          fontWeight: 700,
                          color: idx >= 0 ? brushColor(idx) : '#8a929e',
                          lineHeight: 1.4,
                        }}
                      >
                        {l.startTime}-{l.endTime}
                      </div>
                    );
                  })}
                </button>
              );
            })}
          </div>
        </div>

        {/* 右栏：已选清单 + 命名 + 保存 */}
        <div style={{ width: 264, borderLeft: '1px solid #eef0f3', paddingLeft: 22 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#5b6472' }}>已选 {state.lessons.length} 节</div>
          <div style={{ margin: '8px 0 16px', maxHeight: 300, overflowY: 'auto' }}>
            {sortedLessons(state).map((l) => {
              const idx = brushIndexOf(state, l);
              return (
                <div
                  key={`${l.date}-${l.startTime}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, lineHeight: 2 }}
                >
                  <span className="mono" style={{ color: '#3c4451' }}>
                    {md(l.date)} {weekdayCN(l.date)}
                  </span>
                  <span className="mono" style={{ color: idx >= 0 ? brushColor(idx) : '#8a929e', fontWeight: 600 }}>
                    {l.startTime}–{l.endTime}
                  </span>
                  <button
                    onClick={() => setState(removeLesson(state, l.date, l.startTime))}
                    title="移除该节"
                    style={{
                      marginLeft: 'auto',
                      border: 'none',
                      background: 'transparent',
                      color: '#c0c6cf',
                      cursor: 'pointer',
                      fontSize: 14,
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
            {state.lessons.length === 0 && (
              <div style={{ color: '#b7bec8', fontSize: 12.5, padding: '10px 0' }}>点日历日期开始排课</div>
            )}
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#5b6472', marginBottom: 6 }}>周期名称</div>
          <input
            value={state.name}
            onChange={(e) => setState(setName(state, e.target.value))}
            placeholder="如 2026 暑期七月班"
            style={{ ...fieldStyle, marginBottom: 14 }}
          />
          <button
            onClick={onSave}
            disabled={busy || !canSave(state)}
            style={{
              ...primaryBtn,
              width: '100%',
              background: '#4f6ef7',
              opacity: busy || !canSave(state) ? 0.55 : 1,
            }}
          >
            {busy ? '保存中…' : editing ? '保存修改' : '创建课程周期'}
          </button>
          {editing && (
            <div style={{ fontSize: 12, color: '#9aa1ac', marginTop: 10, lineHeight: 1.6 }}>
              已生成收款批次的周期改日期后，批次快照不会自动变，请到批次详情页「重新计算」。
            </div>
          )}
        </div>
      </div>
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
const smallGhostBtn: CSSProperties = {
  height: 28,
  padding: '0 11px',
  background: '#fff',
  color: '#5b6472',
  border: '1px solid #e2e5ea',
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 12.5,
  cursor: 'pointer',
};
const timeInput: CSSProperties = {
  height: 28,
  padding: '0 8px',
  border: '1px solid #e2e5ea',
  borderRadius: 7,
  fontSize: 12.5,
  color: '#1e2430',
  background: '#fff',
};

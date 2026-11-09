import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { ClassAttendance, MakeupRecord } from '../api/attendance';
import { dateParts, weekdayCN } from '../lib/attendance';
import { nowSql } from '../lib/classroomStore';
import { makeupCandidates, validateMakeupForm, type MakeupDraft } from '../lib/makeup';
import { useCreateMakeupMutation, useUpdateMakeupMutation, useDeleteMakeupMutation } from '../queries/attendance';
import { Modal } from './Modal';
import { useToast } from './Toast';
import './makeup.css';

const REASON = { off: '未在班', absent: '缺勤', leave: '请假' };

/** 每次打开由父组件挂载新实例建立草稿；读取刷新只更新候选，不覆盖填写内容。 */
export function MakeupFormModal({
  data,
  initial,
  editing,
  onClose,
}: {
  data: ClassAttendance;
  initial?: { studentId: string; sessionId: string };
  editing?: MakeupRecord;
  onClose: () => void;
}) {
  const toast = useToast();
  const create = useCreateMakeupMutation();
  const update = useUpdateMakeupMutation();
  const remove = useDeleteMakeupMutation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState<MakeupDraft>(() => ({
    studentId: editing?.studentId ?? initial?.studentId ?? '',
    date: editing?.date ?? nowSql().slice(0, 10),
    durationMinutes: editing?.durationMinutes == null ? '' : String(editing.durationMinutes),
    note: editing?.note ?? '',
    sessionIds: editing ? [...editing.sessionIds] : initial ? [initial.sessionId] : [],
  }));
  const [errors, setErrors] = useState<ReturnType<typeof validateMakeupForm>>({});
  const [selectionChanged, setSelectionChanged] = useState(false);
  const candidates = useMemo(
    () => (draft.studentId ? makeupCandidates(data, draft.studentId, editing?.id) : []),
    [data, draft.studentId, editing?.id],
  );
  const available = useMemo(() => new Set(candidates.map((c) => c.session.id)), [candidates]);
  const selectedIds = draft.sessionIds.filter((id) => available.has(id));
  const busy = create.isPending || update.isPending || remove.isPending;

  useEffect(() => {
    if (draft.sessionIds.some((id) => !available.has(id))) {
      setDraft((current) => ({ ...current, sessionIds: current.sessionIds.filter((id) => available.has(id)) }));
      setSelectionChanged(true);
    }
  }, [available, draft.sessionIds]);

  const setField = <K extends keyof MakeupDraft>(key: K, value: MakeupDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const validDraft = { ...draft, sessionIds: selectedIds };
    const nextErrors = validateMakeupForm(validDraft, {
      durationRequired: !editing || editing.durationMinutes !== null,
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const input = {
      studentId: draft.studentId,
      date: draft.date,
      durationMinutes: draft.durationMinutes === '' ? null : Number(draft.durationMinutes),
      note: draft.note.trim() ? draft.note : null,
      sessionIds: selectedIds,
    };
    try {
      if (editing) await update.mutateAsync({ classId: data.classId, makeupId: editing.id, input });
      else await create.mutateAsync({ classId: data.classId, input });
      toast(editing ? '补课记录已更新' : '补课记录已登记');
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : '保存失败，请重试', 'error');
    }
  };

  const deleteRecord = async () => {
    if (!editing || busy) return;
    try {
      await remove.mutateAsync({ classId: data.classId, makeupId: editing.id, studentId: editing.studentId });
      toast('补课记录已删除');
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : '删除失败，请重试', 'error');
    }
  };

  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={editing ? '编辑补课记录' : '登记补课'}
      width={620}
    >
      {confirmDelete ? (
        <div className="makeup-form">
          {editing?.sessionIds.length ? (
            <p>删除后，它抵扣的 {editing.sessionIds.length} 节课将恢复为原状态，确定吗？</p>
          ) : (
            <p>确定删除这条补课记录吗？</p>
          )}
          <div className="makeup-actions">
            <button disabled={busy} onClick={() => setConfirmDelete(false)}>
              取消
            </button>
            <button className="makeup-danger" disabled={busy} onClick={() => void deleteRecord()}>
              {busy ? '删除中…' : '确认删除补课记录'}
            </button>
          </div>
        </div>
      ) : (
        <form className="makeup-form" aria-label="补课记录表单" onSubmit={(event) => void save(event)} noValidate>
          <fieldset disabled={busy}>
            <label htmlFor="makeup-student">学生</label>
            <select
              id="makeup-student"
              value={draft.studentId}
              disabled={!!editing}
              onChange={(e) => {
                setDraft((current) => ({ ...current, studentId: e.target.value, sessionIds: [] }));
                setErrors({});
                setSelectionChanged(false);
              }}
            >
              <option value="">请选择学生</option>
              {data.students
                .filter((s) => s.status !== 'archived')
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              {editing && !data.students.some((s) => s.id === editing.studentId) && (
                <option value={editing.studentId}>{editing.studentName}（已归档）</option>
              )}
            </select>
            {errors.studentId && <p className="makeup-error">{errors.studentId}</p>}

            <label htmlFor="makeup-date">补课日期</label>
            <input id="makeup-date" type="date" value={draft.date} onChange={(e) => setField('date', e.target.value)} />
            {errors.date && <p className="makeup-error">{errors.date}</p>}

            <label htmlFor="makeup-duration">时长（分钟）</label>
            <input
              id="makeup-duration"
              type="number"
              inputMode="numeric"
              min="1"
              max="600"
              step="1"
              value={draft.durationMinutes}
              onChange={(e) => setField('durationMinutes', e.target.value)}
              placeholder={editing?.durationMinutes === null ? '未记录时长，可补填' : '1–600'}
            />
            <div className="makeup-presets">
              {[30, 45, 60, 90, 120].map((n) => (
                <button
                  type="button"
                  key={n}
                  aria-pressed={draft.durationMinutes === String(n)}
                  onClick={() => setField('durationMinutes', String(n))}
                >
                  {n}
                </button>
              ))}
            </div>
            {errors.durationMinutes && <p className="makeup-error">{errors.durationMinutes}</p>}

            <div className="makeup-candidate-heading">
              <span>抵扣的课</span>
              <span>已选 {selectedIds.length} 节</span>
            </div>
            {selectionChanged && (
              <p className="makeup-warning" role="status">
                部分课程已不可抵扣，已取消勾选，请重新选择
              </p>
            )}
            {!draft.studentId ? (
              <p className="makeup-hint">请先选择学生</p>
            ) : !candidates.length ? (
              <p className="makeup-hint">该学生暂时没有可抵扣的缺课，可以先登记，之后有缺课时再编辑这条记录勾选</p>
            ) : (
              <>
                <label className="makeup-check">
                  <input
                    type="checkbox"
                    checked={selectedIds.length === candidates.length}
                    onChange={(e) =>
                      setField('sessionIds', e.target.checked ? candidates.map((c) => c.session.id) : [])
                    }
                  />
                  全选
                </label>
                <div className="makeup-candidates">
                  {candidates.map(({ session, reason }) => {
                    const { mm, dd } = dateParts(session.date);
                    return (
                      <label className="makeup-check makeup-candidate" key={session.id}>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(session.id)}
                          onChange={(e) =>
                            setField(
                              'sessionIds',
                              e.target.checked
                                ? [...selectedIds, session.id]
                                : selectedIds.filter((id) => id !== session.id),
                            )
                          }
                        />
                        <span>
                          {mm}/{dd} {weekdayCN(session.date)}{' '}
                          <strong>
                            {session.lessonNumber == null ? '' : `L${session.lessonNumber}`} {session.lessonTitle}
                          </strong>
                        </span>
                        <small>{REASON[reason]}</small>
                      </label>
                    );
                  })}
                </div>
              </>
            )}

            <label htmlFor="makeup-note">备注（可选）</label>
            <textarea
              id="makeup-note"
              rows={3}
              value={draft.note}
              onChange={(e) => setField('note', e.target.value)}
              placeholder="例如：复习了哪些内容"
            />
            <div className="makeup-actions">
              {editing && (
                <button type="button" className="makeup-delete" onClick={() => setConfirmDelete(true)}>
                  删除这条补课记录
                </button>
              )}
              <button type="button" onClick={onClose}>
                取消
              </button>
              <button type="submit" className="makeup-primary">
                {busy ? '保存中…' : '保存补课记录'}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </Modal>
  );
}

import { useEffect, useState, type CSSProperties } from 'react';
import { api, type TeacherItem } from '../lib/api';
import { BOOK_LABELS, BOOKS } from '../lib/homework';
import { GREEN } from '../lib/theme';
import { Modal } from './Modal';
import { useToast } from './Toast';

export interface ClassInfoValues {
  name: string;
  teacherId: string;
  textbook: number | null;
}

/**
 * 班级基本信息表单弹窗（名称/教材册数/负责老师），新建班级（ClassList）与
 * 编辑班级信息（ClassDetail）共用。onSubmit 由调用方注入（API 调用 + reload +
 * 成功 toast/跳转），成功后弹窗自动关闭，抛错则留在弹窗并提示 errorText。
 */
export function ClassInfoModal({
  open,
  onClose,
  title,
  submitLabel,
  busyLabel,
  errorText,
  initial,
  fallbackTeacherName,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  submitLabel: string;
  busyLabel: string;
  errorText: string;
  /** 打开弹窗时的表单初值快照 */
  initial: ClassInfoValues;
  /** initial.teacherId 不在老师列表里时（列表未加载/历史行）下拉显示的名字 */
  fallbackTeacherName?: string;
  onSubmit: (v: ClassInfoValues) => Promise<void>;
}) {
  const toast = useToast();
  const [teachers, setTeachers] = useState<TeacherItem[]>([]);
  const [name, setName] = useState('');
  const [textbook, setTextbook] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initial.name);
    setTextbook(initial.textbook != null ? String(initial.textbook) : '');
    setTeacherId(initial.teacherId);
    api
      .teachers()
      .then(setTeachers)
      .catch(() => toast('老师列表加载失败', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function save() {
    if (!name.trim() || !teacherId || busy) return;
    setBusy(true);
    try {
      await onSubmit({ name: name.trim(), teacherId, textbook: textbook ? Number(textbook) : null });
      onClose();
    } catch {
      toast(errorText, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <label style={labelStyle}>班级名称</label>
      <input
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        placeholder="如 三年级A班"
        style={fieldStyle}
      />
      <label style={{ ...labelStyle, margin: '14px 0 6px' }}>
        教材册数 <span style={{ fontWeight: 400, color: '#9aa1ac' }}>（课文复习默认按此册）</span>
      </label>
      <select
        value={textbook}
        onChange={(e) => setTextbook(e.target.value)}
        style={{ ...fieldStyle, cursor: 'pointer' }}
      >
        <option value="">未设置</option>
        {BOOKS.map((b) => (
          <option key={b} value={b}>
            {BOOK_LABELS[b]}
          </option>
        ))}
      </select>
      <label style={{ ...labelStyle, margin: '14px 0 6px' }}>负责老师</label>
      <select
        value={teacherId}
        onChange={(e) => setTeacherId(e.target.value)}
        style={{ ...fieldStyle, cursor: 'pointer' }}
      >
        {!teachers.some((t) => t.id === teacherId) && <option value={teacherId}>{fallbackTeacherName ?? ''}</option>}
        {teachers.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button style={ghostBtn} onClick={onClose} disabled={busy}>
          取消
        </button>
        <button style={{ ...primaryBtn, opacity: name.trim() && teacherId && !busy ? 1 : 0.55 }} onClick={save}>
          {busy ? busyLabel : submitLabel}
        </button>
      </div>
    </Modal>
  );
}

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 12.5,
  fontWeight: 600,
  color: '#5b6472',
  marginBottom: 6,
};
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

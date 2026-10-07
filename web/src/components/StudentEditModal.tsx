import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { validateStudentNameForm } from '../lib/studentName';
import { GREEN } from '../lib/theme';
import { useUpdateStudentMutation } from '../queries/students';
import { Modal } from './Modal';
import { useToast } from './Toast';

// ---------------------------------------------------------------------------
// 全局「编辑学生」弹窗：Provider 内部只挂一个 Modal 实例，任何页面（含 .map()
// 循环里的卡片/表格行）通过 useStudentModal() 拿到的 open 函数触发。理由同
// ToastProvider——省掉每页 hoist 一份 editing state 再把回调穿过循环的 plumbing。
// 只做编辑：新建走各页面自己的表单，两者共用 lib/studentName 的校验。
// 改名后的刷新由 useUpdateStudentMutation 负责（班级、档案、历史课堂、考勤、收费里的名字都会更新），
// 调用页面不用再传 reload；onSaved 只作交互通知。
// ---------------------------------------------------------------------------

export interface StudentEditTarget {
  studentId: string;
  name: string;
  cnName: string | null;
  /** 所属班级：只用来收窄缓存失效范围，不发给后端；不传则从缓存推断。 */
  classId?: string;
}

type OpenFn = (target: StudentEditTarget, onSaved?: () => void) => void;

const StudentModalCtx = createContext<OpenFn>(() => {});

export function StudentModalProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [target, setTarget] = useState<StudentEditTarget | null>(null);
  const [name, setName] = useState('');
  const [cnName, setCnName] = useState('');
  const update = useUpdateStudentMutation();
  const busy = update.isPending;
  const savedCb = useRef<(() => void) | undefined>(undefined);

  const open = useCallback<OpenFn>((t, onSaved) => {
    savedCb.current = onSaved;
    setName(t.name);
    setCnName(t.cnName ?? '');
    setTarget(t);
  }, []);

  const close = useCallback(() => setTarget(null), []);

  async function save() {
    if (!target || busy) return;
    const v = validateStudentNameForm({ name, cnName });
    if ('error' in v) return toast(v.error, 'error');
    try {
      await update.mutateAsync({ studentId: target.studentId, classId: target.classId, input: v });
      toast('学生信息已更新');
      setTarget(null);
      savedCb.current?.();
    } catch {
      toast('保存失败，请重试', 'error');
    }
  }

  return (
    <StudentModalCtx.Provider value={open}>
      {children}
      <Modal open={!!target} onClose={close} title="编辑学生">
        <Field label="英文名">
          <input
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder="如 Lucy"
            style={fieldStyle}
          />
        </Field>
        <div style={{ height: 14 }} />
        <Field label="中文名（选填）">
          <input
            value={cnName}
            onChange={(e) => setCnName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder="如 王小明"
            style={fieldStyle}
          />
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button style={ghostBtn} onClick={close}>
            取消
          </button>
          <button style={{ ...primaryBtn, opacity: name.trim() && !busy ? 1 : 0.55 }} onClick={save}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </Modal>
    </StudentModalCtx.Provider>
  );
}

/** `open(target, onSaved?)` — 刷新由 Mutation 完成；onSaved 只是保存成功后的交互通知（可不传）。 */
export function useStudentModal(): OpenFn {
  return useContext(StudentModalCtx);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#5b6472', marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const fieldStyle = {
  width: '100%',
  height: 40,
  padding: '0 12px',
  border: '1px solid #e2e5ea',
  borderRadius: 9,
  fontSize: 14,
  color: '#1e2430',
  background: '#fbfcfd',
} as const;

const primaryBtn = {
  height: 40,
  padding: '0 18px',
  background: GREEN,
  color: '#fff',
  border: 'none',
  borderRadius: 9,
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
} as const;

const ghostBtn = {
  height: 40,
  padding: '0 18px',
  background: '#fff',
  color: '#5b6472',
  border: '1px solid #e2e5ea',
  borderRadius: 9,
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
} as const;

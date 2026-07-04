import { useState, type CSSProperties } from 'react';
import { useToast } from './Toast';

// 作业模板卡片（NotesTab 同款编辑/查看切换）：班级管理「作业模板」tab 与
// session 详情页「作业布置」tab 共用；保存动作由调用方注入（都落到
// PUT /api/classes/:id/homework-template）。

export function HomeworkTemplateEditor({
  template,
  onSave,
}: {
  template: string | null;
  onSave: (value: string) => Promise<unknown>;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      await onSave(draft);
      toast('作业模板已保存');
      setEditing(false);
    } catch {
      toast('保存失败，请重试', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e7e9ee', borderRadius: 14, padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>作业模板</div>
        <div style={{ fontSize: 12.5, color: '#aab1bc' }}>
          绑定本班级 · 生成时替换 {'{lesson_number}'} {'{date}'} {'{class_name}'}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          {editing ? (
            <>
              <button style={ghostBtn} onClick={() => setEditing(false)} disabled={busy}>
                取消
              </button>
              <button style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} onClick={save} disabled={busy}>
                {busy ? '保存中…' : '保存'}
              </button>
            </>
          ) : (
            <button
              style={ghostBtn}
              onClick={() => {
                setDraft(template ?? '');
                setEditing(true);
              }}
            >
              ✎ 编辑
            </button>
          )}
        </div>
      </div>
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={'- L{lesson_number} 三英一汉，听写三遍\n- 练字三面\n- 背L{lesson_number}'}
          autoFocus
          style={textareaStyle}
        />
      ) : template ? (
        <pre
          style={{
            margin: 0,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 13.5,
            lineHeight: 1.65,
            color: '#3c4451',
            whiteSpace: 'pre-wrap',
          }}
        >
          {template}
        </pre>
      ) : (
        <div style={{ color: '#aab1bc', fontSize: 14, padding: '22px 0', textAlign: 'center' }}>
          还没有作业模板，点击右上角「编辑」添加
        </div>
      )}
    </div>
  );
}

const textareaStyle: CSSProperties = {
  width: '100%',
  minHeight: 150,
  padding: '12px 14px',
  border: '1px solid #e2e5ea',
  borderRadius: 10,
  background: '#fbfcfd',
  color: '#1e2430',
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 13.5,
  lineHeight: 1.65,
  resize: 'vertical',
  outline: 'none',
};
const primaryBtn: CSSProperties = {
  height: 40,
  padding: '0 18px',
  background: '#2fb457',
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

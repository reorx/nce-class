import { useEffect, useState, type CSSProperties } from 'react';
import { Modal } from '../components/Modal';
import { TopBar } from '../components/TopBar';
import { useToast } from '../components/Toast';
import { api, ApiError, type Me, type TeacherItem } from '../lib/api';
import { GREEN, squareAvatarStyle } from '../lib/theme';

export function Teachers({ me }: { me: Me | null }) {
  const [teachers, setTeachers] = useState<TeacherItem[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<TeacherItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const toast = useToast();

  const reload = () =>
    api
      .teachers()
      .then(setTeachers)
      .catch(() => {});

  useEffect(() => {
    reload();
  }, []);

  const valid = name.trim() && username.trim() && password.length >= 6;

  async function submitAdd() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await api.createTeacher(name.trim(), username.trim(), password);
      await reload();
      toast(`已添加「${name.trim()}」`);
      setAddOpen(false);
      setName('');
      setUsername('');
      setPassword('');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '添加失败，请重试', 'error');
    } finally {
      setBusy(false);
    }
  }

  function openEdit(t: TeacherItem) {
    setEditing(t);
    setEditName(t.name);
    setEditPassword('');
  }

  // 姓名必填；密码留空则不改，否则至少 6 位。
  const editValid = editName.trim() && (editPassword.length === 0 || editPassword.length >= 6);

  async function submitEdit() {
    if (!editing || !editValid || editBusy) return;
    setEditBusy(true);
    try {
      const p: { name: string; password?: string } = { name: editName.trim() };
      if (editPassword.length > 0) p.password = editPassword;
      await api.updateTeacher(editing.id, p);
      await reload();
      toast(`已保存「${editName.trim()}」`);
      setEditing(null);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '保存失败，请重试', 'error');
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar me={me} active="teachers" />
      <div style={{ flex: 1, width: '100%', maxWidth: 1140, margin: '0 auto', padding: '30px 26px 64px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-.3px' }}>老师</h1>
            <div style={{ marginTop: 6, fontSize: 13.5, color: '#7a828f' }}>
              {teachers.length} 位老师 · 同校老师共享班级与学生 · 权限暂不细分
            </div>
          </div>
          <button
            onClick={() => setAddOpen(true)}
            style={{
              marginLeft: 'auto',
              height: 38,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 16px',
              background: GREEN,
              color: '#fff',
              border: 'none',
              borderRadius: 9,
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(47,180,87,.26)',
            }}
          >
            <span style={{ fontSize: 17, fontWeight: 400, lineHeight: 1 }}>+</span>添加老师
          </button>
        </div>

        <div style={{ background: '#fff', border: '1px solid #e7e9ee', borderRadius: 13, overflow: 'hidden' }}>
          {teachers.map((t, i) => (
            <div
              key={t.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 13,
                padding: '13px 18px',
                borderTop: i === 0 ? 'none' : '1px solid #eef0f3',
              }}
            >
              <div style={squareAvatarStyle(t.name, 38)}>{t.name[0]}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    className="dc-name-link"
                    onClick={() => openEdit(t)}
                    title="编辑老师"
                    style={{ fontWeight: 700, fontSize: 14.5, color: '#1e2430', cursor: 'pointer' }}
                  >
                    {t.name}
                  </span>
                  {t.id === me?.id && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#3f7a56',
                        background: '#eef6f0',
                        border: '1px solid #dcecdf',
                        padding: '1px 7px',
                        borderRadius: 6,
                      }}
                    >
                      我
                    </span>
                  )}
                </div>
                <div className="mono" style={{ marginTop: 3, fontSize: 12, color: '#9aa1ac' }}>
                  {t.username}
                </div>
              </div>
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: 12,
                  fontWeight: 600,
                  color: t.role === 'owner' ? '#586099' : '#7a828f',
                  background: t.role === 'owner' ? '#eef0f8' : '#f0f2f5',
                  padding: '3px 10px',
                  borderRadius: 7,
                }}
              >
                {t.role === 'owner' ? '负责人' : '老师'}
              </span>
            </div>
          ))}
          {teachers.length === 0 && (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: '#9aa1ac', fontSize: 13.5 }}>
              还没有老师
            </div>
          )}
        </div>
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="添加老师">
        <label style={labelStyle}>姓名</label>
        <input
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          placeholder="如 李芳"
          style={fieldStyle}
        />
        <label style={{ ...labelStyle, marginTop: 15 }}>用户名</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="如 lifang，用于登录"
          style={fieldStyle}
        />
        <label style={{ ...labelStyle, marginTop: 15 }}>密码</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitAdd()}
          placeholder="至少 6 位"
          style={fieldStyle}
        />
        <div style={{ marginTop: 8, fontSize: 12, color: '#9aa1ac' }}>
          告知对方用户名和密码即可登录；未来将改为微信邀请。
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
          <button
            style={{
              height: 40,
              padding: '0 18px',
              background: '#fff',
              color: '#5b6472',
              border: '1px solid #e2e5ea',
              borderRadius: 9,
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
            }}
            onClick={() => setAddOpen(false)}
          >
            取消
          </button>
          <button
            style={{
              height: 40,
              padding: '0 18px',
              background: GREEN,
              color: '#fff',
              border: 'none',
              borderRadius: 9,
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              opacity: valid && !busy ? 1 : 0.55,
            }}
            onClick={submitAdd}
          >
            {busy ? '添加中…' : '添加老师'}
          </button>
        </div>
      </Modal>

      <Modal open={editing != null} onClose={() => setEditing(null)} title="编辑老师">
        <label style={labelStyle}>姓名</label>
        <input
          value={editName}
          autoFocus
          onChange={(e) => setEditName(e.target.value)}
          placeholder="如 李芳"
          style={fieldStyle}
        />
        <label style={{ ...labelStyle, marginTop: 15 }}>用户名</label>
        <input
          value={editing?.username ?? ''}
          readOnly
          disabled
          style={{ ...fieldStyle, background: '#f2f4f6', color: '#9aa1ac', cursor: 'not-allowed' }}
        />
        <div style={{ marginTop: 5, fontSize: 12, color: '#9aa1ac' }}>用户名不可修改。</div>
        <label style={{ ...labelStyle, marginTop: 15 }}>新密码</label>
        <input
          type="password"
          value={editPassword}
          onChange={(e) => setEditPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitEdit()}
          placeholder="留空则不修改"
          style={fieldStyle}
        />
        <div style={{ marginTop: 5, fontSize: 12, color: '#9aa1ac' }}>如需重置密码，请输入至少 6 位新密码。</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
          <button
            style={{
              height: 40,
              padding: '0 18px',
              background: '#fff',
              color: '#5b6472',
              border: '1px solid #e2e5ea',
              borderRadius: 9,
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
            }}
            onClick={() => setEditing(null)}
          >
            取消
          </button>
          <button
            style={{
              height: 40,
              padding: '0 18px',
              background: GREEN,
              color: '#fff',
              border: 'none',
              borderRadius: 9,
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              opacity: editValid && !editBusy ? 1 : 0.55,
            }}
            onClick={submitEdit}
          >
            {editBusy ? '保存中…' : '保存'}
          </button>
        </div>
      </Modal>
    </div>
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

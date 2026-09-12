import { useEffect, useState, type CSSProperties } from 'react';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { TopBar } from '../components/TopBar';
import { deleteImpactLines, paidWarning, resetFormValid } from '../lib/admin';
import { api, ApiError, type AdminClassItem, type Me, type TeacherItem } from '../lib/api';
import { clearSession } from '../lib/classroomStore';
import { fmtMoney } from '../lib/money';
import { GREEN, squareAvatarStyle, teacherBadgeStyle } from '../lib/theme';

const RED = '#d94a4a';

// 管理页：删除班级 / 修改成员密码。/api/admin/* 由服务端按 is_admin 强制鉴权，
// 这里的门禁只是展示层（非管理员不发请求，直接显示无权限）。
export function Admin({ me }: { me: Me | null }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar me={me} active="admin" />
      <div style={{ flex: 1, width: '100%', maxWidth: 1140, margin: '0 auto', padding: '30px 26px 64px' }}>
        {me?.isAdmin ? <AdminPanel me={me} /> : <NoAccess />}
      </div>
    </div>
  );
}

function NoAccess() {
  return (
    <div style={{ ...card, padding: '56px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 30, lineHeight: 1 }}>🔒</div>
      <div style={{ marginTop: 12, fontWeight: 700, fontSize: 16, color: '#1e2430' }}>无权限</div>
      <div style={{ marginTop: 6, fontSize: 13.5, color: '#7a828f' }}>管理页仅对管理员开放。</div>
    </div>
  );
}

function AdminPanel({ me }: { me: Me }) {
  const toast = useToast();
  const [classes, setClasses] = useState<AdminClassItem[] | null>(null);
  const [teachers, setTeachers] = useState<TeacherItem[]>([]);
  const [deleting, setDeleting] = useState<AdminClassItem | null>(null);
  const [resetting, setResetting] = useState<TeacherItem | null>(null);

  const reloadClasses = () =>
    api
      .adminClasses()
      .then(setClasses)
      .catch((e) => toast(e instanceof ApiError ? e.message : '班级加载失败', 'error'));

  useEffect(() => {
    reloadClasses();
    api
      .teachers()
      .then(setTeachers)
      .catch(() => toast('老师加载失败', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-.3px' }}>管理</h1>
      <div style={{ marginTop: 6, fontSize: 13.5, color: '#7a828f' }}>
        高危操作，仅管理员可见 · 每次操作都要再输入一次你的登录密码
      </div>

      <SectionHead title="删除班级" hint="连同该班学生、上课记录、排班与收款数据一并永久删除，无法恢复" />
      <div style={card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead>
              <tr style={{ color: '#8a929e', textAlign: 'left', borderBottom: '1px solid #ebedf1' }}>
                <th style={th}>班级</th>
                <th style={th}>负责老师</th>
                <th style={thNum}>学生</th>
                <th style={thNum}>上课记录</th>
                <th style={thNum}>排班周期</th>
                <th style={thNum}>收款批次</th>
                <th style={thNum}>已确认收款</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {(classes ?? []).map((c, i) => (
                <tr key={c.id} style={{ borderTop: i === 0 ? 'none' : '1px solid #eef0f3' }}>
                  <td style={{ ...td, fontWeight: 600, color: '#1e2430' }}>{c.name}</td>
                  <td style={td}>{c.teacherName}</td>
                  <td style={tdNum}>{c.studentCount}</td>
                  <td style={tdNum}>{c.sessionCount}</td>
                  <td style={tdNum}>{c.scheduleCount}</td>
                  <td style={tdNum}>{c.batchCount}</td>
                  <td style={{ ...tdNum, color: c.paidInvoiceCount > 0 ? '#2c7a48' : '#b3b9c2' }}>
                    {c.paidInvoiceCount > 0 ? `${c.paidInvoiceCount} 张 · ${fmtMoney(c.paidAmountCents)}` : '—'}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button style={{ ...smallBtn, color: RED, borderColor: '#f1d3d3' }} onClick={() => setDeleting(c)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {classes?.length === 0 && <div style={emptyStyle}>没有班级</div>}
      </div>

      <SectionHead title="修改成员密码" hint="为忘记密码的老师设置新密码，设置后请告知对方" />
      <div style={card}>
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
                <span style={{ fontWeight: 700, fontSize: 14.5, color: '#1e2430' }}>{t.name}</span>
                {t.id === me.id && <span style={teacherBadgeStyle('me')}>我</span>}
                {t.isAdmin && <span style={teacherBadgeStyle('admin')}>管理员</span>}
              </div>
              <div className="mono" style={{ marginTop: 3, fontSize: 12, color: '#9aa1ac' }}>
                {t.username}
              </div>
            </div>
            <button style={{ ...smallBtn, marginLeft: 'auto' }} onClick={() => setResetting(t)}>
              修改密码
            </button>
          </div>
        ))}
      </div>

      {deleting && (
        <DeleteClassModal
          item={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            reloadClasses();
          }}
        />
      )}
      {resetting && <ResetPasswordModal teacher={resetting} onClose={() => setResetting(null)} />}
    </>
  );
}

function SectionHead({ title, hint }: { title: string; hint: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', margin: '30px 0 12px' }}>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1e2430' }}>{title}</h2>
      <span style={{ fontSize: 12.5, color: '#9aa1ac' }}>{hint}</span>
    </div>
  );
}

function DeleteClassModal({
  item,
  onClose,
  onDeleted,
}: {
  item: AdminClassItem;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [adminPassword, setAdminPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const warning = paidWarning(item);

  async function submit() {
    if (!adminPassword || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.adminDeleteClass(item.id, adminPassword);
      clearSession(item.id); // 本机若残留该班进行中课堂，已无处可提交
      toast(`已删除「${item.name}」`);
      onDeleted();
    } catch (e) {
      // 403 = 管理员密码错误（或权限刚被撤销）→ 就地提示；其余走 toast
      if (e instanceof ApiError && e.status === 403) setError(e.message);
      else toast(e instanceof ApiError ? e.message : '删除失败，请重试', 'error');
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="删除班级" width={470}>
      <div style={{ fontSize: 14, color: '#3c4451', lineHeight: 1.7 }}>
        确定删除「<b>{item.name}</b>」吗？以下数据会被<b>永久删除，无法恢复</b>：
        <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
          {deleteImpactLines(item).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {warning && <div style={{ color: RED, marginTop: 10, fontWeight: 600 }}>{warning}</div>}
        <div style={{ color: '#8a929e', marginTop: 8, fontSize: 12.5 }}>机构奖章库与家长的微信账号本身不受影响。</div>
      </div>
      <label style={{ ...labelStyle, marginTop: 18 }}>输入你的登录密码以确认</label>
      <input
        type="password"
        autoFocus
        autoComplete="current-password"
        value={adminPassword}
        onChange={(e) => {
          setAdminPassword(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="管理员密码"
        style={{ ...fieldStyle, border: `1px solid ${error ? RED : '#e2e5ea'}` }}
      />
      {error && <div style={errorStyle}>{error}</div>}
      <div style={footerStyle}>
        <button style={cancelBtn} onClick={onClose}>
          取消
        </button>
        <button
          style={{ ...modalBtn, background: RED, color: '#fff', opacity: adminPassword && !busy ? 1 : 0.55 }}
          onClick={submit}
        >
          {busy ? '删除中…' : '永久删除'}
        </button>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ teacher, onClose }: { teacher: TeacherItem; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = resetFormValid(password, adminPassword);

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.adminResetPassword(teacher.id, password, adminPassword);
      toast(`已修改「${teacher.name}」的密码，请告知对方新密码`);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setError(e.message);
      else toast(e instanceof ApiError ? e.message : '修改失败，请重试', 'error');
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`修改密码 — ${teacher.name}`}>
      <label style={labelStyle}>新密码</label>
      <input
        autoFocus
        autoComplete="off"
        spellCheck={false}
        className="mono"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="至少 6 位"
        style={fieldStyle}
      />
      <div style={{ marginTop: 5, fontSize: 12, color: '#9aa1ac' }}>
        明文显示，方便转告 {teacher.name}（<span className="mono">{teacher.username}</span>
        ）。对方已登录的设备不会被登出。
      </div>
      <label style={{ ...labelStyle, marginTop: 15 }}>你的登录密码</label>
      <input
        type="password"
        autoComplete="current-password"
        value={adminPassword}
        onChange={(e) => {
          setAdminPassword(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="管理员密码，用于确认本次操作"
        style={{ ...fieldStyle, border: `1px solid ${error ? RED : '#e2e5ea'}` }}
      />
      {error && <div style={errorStyle}>{error}</div>}
      <div style={footerStyle}>
        <button style={cancelBtn} onClick={onClose}>
          取消
        </button>
        <button
          style={{ ...modalBtn, background: GREEN, color: '#fff', opacity: valid && !busy ? 1 : 0.55 }}
          onClick={submit}
        >
          {busy ? '保存中…' : '修改密码'}
        </button>
      </div>
    </Modal>
  );
}

const card: CSSProperties = { background: '#fff', border: '1px solid #e7e9ee', borderRadius: 13, overflow: 'hidden' };
const th: CSSProperties = { padding: '10px 16px', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' };
const thNum: CSSProperties = { ...th, textAlign: 'right' };
const td: CSSProperties = { padding: '12px 16px', color: '#3c4451', whiteSpace: 'nowrap' };
const tdNum: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const emptyStyle: CSSProperties = { padding: '40px 24px', textAlign: 'center', color: '#9aa1ac', fontSize: 13.5 };
const smallBtn: CSSProperties = {
  height: 32,
  padding: '0 13px',
  background: '#fff',
  color: '#5b6472',
  border: '1px solid #e2e5ea',
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
const modalBtn: CSSProperties = {
  height: 40,
  padding: '0 18px',
  border: 'none',
  borderRadius: 9,
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};
const cancelBtn: CSSProperties = { ...modalBtn, background: '#fff', color: '#5b6472', border: '1px solid #e2e5ea' };
const footerStyle: CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 };
const errorStyle: CSSProperties = { marginTop: 6, fontSize: 12.5, color: RED };
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

import { useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, type Me } from '../lib/api';
import { GREEN, GREEN_DARK } from '../lib/theme';

export function Login({ onLogin }: { onLogin: (me: Me) => void }) {
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const me = await api.login(username.trim(), password);
      onLogin(me);
      nav('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请稍后重试');
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: 'linear-gradient(160deg,#eef7f1 0%,#f6f7f9 60%)',
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: '100%',
          maxWidth: 384,
          background: '#fff',
          border: '1px solid #e7e9ee',
          borderRadius: 18,
          padding: '34px 32px 30px',
          boxShadow: '0 18px 48px rgba(20,28,45,.1)',
          animation: 'dc-pop .18s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 22 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 11,
              background: GREEN,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 700,
              fontSize: 19,
              boxShadow: '0 3px 9px rgba(47,180,87,.34)',
            }}
          >
            N
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: '.2px' }}>NCE Class 教务台</div>
            <div style={{ fontSize: 12.5, color: '#9aa1ac', marginTop: 2 }}>老师登录后管理班级与课堂</div>
          </div>
        </div>

        <label style={labelStyle}>用户名</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="如 wangli"
          autoFocus
          style={inputStyle}
        />

        <label style={{ ...labelStyle, marginTop: 15 }}>密码</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          style={inputStyle}
        />

        {error && <div style={{ marginTop: 13, fontSize: 12.5, color: '#c0392b', fontWeight: 600 }}>{error}</div>}

        <button
          type="submit"
          disabled={busy}
          style={{
            marginTop: 22,
            width: '100%',
            height: 44,
            border: 'none',
            borderRadius: 10,
            background: busy ? GREEN_DARK : GREEN,
            color: '#fff',
            fontWeight: 700,
            fontSize: 15,
            cursor: busy ? 'default' : 'pointer',
            boxShadow: '0 3px 10px rgba(47,180,87,.28)',
          }}
        >
          {busy ? '登录中…' : '登录'}
        </button>
      </form>
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
const inputStyle: CSSProperties = {
  width: '100%',
  height: 42,
  padding: '0 13px',
  border: '1px solid #e2e5ea',
  borderRadius: 10,
  fontSize: 14,
  color: '#1e2430',
  background: '#fbfcfd',
};

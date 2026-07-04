import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Me } from '../lib/api';

const navBtn = (active: boolean): React.CSSProperties => ({
  padding: '7px 13px',
  borderRadius: 8,
  textDecoration: 'none',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
  background: active ? '#eef1f5' : 'transparent',
  color: active ? '#1e2430' : '#7a828f',
});

export function TopBar({ me, active = 'classes' }: { me: Me | null; active?: 'classes' | 'sessions' | 'teachers' }) {
  const [open, setOpen] = useState(false);
  const name = me?.name ?? '王莉';
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        height: 58,
        padding: '0 26px',
        background: 'rgba(255,255,255,.86)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid #ebedf1',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: '#2fb457',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 700,
            fontSize: 14,
            boxShadow: '0 2px 6px rgba(47,180,87,.32)',
          }}
        >
          N
        </div>
        <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: '.2px' }}>{me?.orgName ?? '晨光英语'}</span>
        <span style={{ fontSize: 12, color: '#9aa1ac', fontWeight: 500 }}>教务台</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginLeft: 6 }}>
        <Link to="/" style={navBtn(active === 'classes')}>
          班级
        </Link>
        <Link to="/sessions" style={navBtn(active === 'sessions')}>
          课堂
        </Link>
        <Link to="/teachers" style={navBtn(active === 'teachers')}>
          老师
        </Link>
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '5px 10px 5px 6px',
            border: '1px solid #e7e9ee',
            borderRadius: 10,
            background: '#fff',
            cursor: 'pointer',
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: '#e9f1ec',
              color: '#3f7a56',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {name[0]}
          </div>
          <span style={{ fontWeight: 600, fontSize: 13.5, color: '#1e2430' }}>{name}</span>
          <span style={{ color: '#9aa1ac', fontSize: 10 }}>▾</span>
        </button>
        {open && (
          <>
            <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: 46,
                zIndex: 31,
                width: 200,
                background: '#fff',
                border: '1px solid #e7e9ee',
                borderRadius: 11,
                boxShadow: '0 12px 34px rgba(20,28,45,.15)',
                padding: 6,
                animation: 'dc-pop .14s ease',
              }}
            >
              <div style={{ padding: '9px 11px 10px', borderBottom: '1px solid #f1f3f6', marginBottom: 5 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5, color: '#1e2430' }}>{name}</div>
                <div className="mono" style={{ fontSize: 11.5, color: '#9aa1ac', marginTop: 2 }}>
                  {me?.username ?? 'wangli'} · {me?.role === 'owner' ? '负责人' : '老师'}
                </div>
              </div>
              {['账户设置', '帮助中心'].map((t) => (
                <button key={t} style={menuItem('#3c4451')}>
                  {t}
                </button>
              ))}
              <div style={{ height: 1, background: '#f1f3f6', margin: '5px 0' }} />
              <button
                style={menuItem('#cf4444')}
                onClick={async () => {
                  await api.logout().catch(() => {});
                  // Full reload clears in-memory auth state and re-runs the guard.
                  window.location.assign('/login');
                }}
              >
                退出登录
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const menuItem = (color: string): React.CSSProperties => ({
  display: 'flex',
  width: '100%',
  padding: '9px 11px',
  border: 'none',
  background: 'transparent',
  borderRadius: 7,
  fontSize: 13.5,
  color,
  textAlign: 'left',
  cursor: 'pointer',
});

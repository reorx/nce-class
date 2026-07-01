import { TopBar } from '../components/TopBar';
import type { Me } from '../lib/api';
import { GREEN } from '../lib/theme';

export function Teachers({ me }: { me: Me | null }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar me={me} active="teachers" />
      <div style={{ flex: 1, width: '100%', maxWidth: 1140, margin: '0 auto', padding: '30px 26px 64px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-.3px' }}>老师</h1>
            <div style={{ marginTop: 6, fontSize: 13.5, color: '#7a828f' }}>同校老师共享班级与学生 · 权限暂不细分</div>
          </div>
          <button
            style={{
              marginLeft: 'auto',
              height: 38,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 16px',
              background: '#fff',
              color: '#3c4451',
              border: '1px solid #e2e5ea',
              borderRadius: 9,
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 17, fontWeight: 400, lineHeight: 1, color: GREEN }}>+</span>邀请老师
          </button>
        </div>
        <div
          style={{
            background: '#fff',
            border: '1px solid #e7e9ee',
            borderRadius: 13,
            padding: '40px 24px',
            textAlign: 'center',
            color: '#9aa1ac',
            fontSize: 13.5,
          }}
        >
          老师管理（M1 极简）· 详见 PRD §7.1
        </div>
      </div>
    </div>
  );
}

import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useParams, type Location } from 'react-router-dom';
import { BackgroundErrorToasts } from './components/BackgroundErrorToasts';
import { SignOutProvider } from './components/SignOut';
import { StudentModalProvider } from './components/StudentEditModal';
import { ToastProvider } from './components/Toast';
import { Admin } from './pages/Admin';
import { Billing } from './pages/Billing';
import { BillingBatch } from './pages/BillingBatch';
import { ClassAttendance } from './pages/ClassAttendance';
import { ClassDetail } from './pages/ClassDetail';
import { ClassList } from './pages/ClassList';
import { Classroom } from './pages/Classroom';
import { Login } from './pages/Login';
import { SessionDetail } from './pages/SessionDetail';
import { Sessions } from './pages/Sessions';
import { Setup } from './pages/Setup';
import { StudentProfile } from './pages/StudentProfile';
import { Teachers } from './pages/Teachers';
import { loadSession } from './lib/classroomStore';
import { authStatus, useMeQuery, type AuthStatus } from './queries/auth';

// 身份只有一个来源：me 查询（queries/auth）。页面拿到的 me prop 就是这份数据的传递。
// 守卫：已登录才渲染受保护页面；未登录跳 /login 并记下来处（会话过期后重新登录回到原页面，
// 本地课堂草稿不受影响）；读取失败（断网 / 5xx / 403）不当成退出，给重试。
// 课堂页例外：本机已有该班进行中的课堂时，身份还在读取或读取失败也直接进课堂（断网刷新照常上课），
// 只有确认未登录（me = null）才去登录页。

/** 守卫跳登录时带上的来处；登录成功后回到这里。 */
const fromOf = (state: unknown): string | null => {
  const from = (state as { from?: string } | null)?.from;
  return typeof from === 'string' && !from.startsWith('/login') ? from : null;
};

const pathOf = (l: Location) => `${l.pathname}${l.search}`;

export function App() {
  const meQuery = useMeQuery();
  const status = authStatus(meQuery);
  const me = meQuery.data ?? null;
  const location = useLocation();

  const pending =
    status === 'error' && !meQuery.isFetching ? (
      <AuthError message={meQuery.error?.message} onRetry={() => meQuery.refetch()} />
    ) : (
      <Splash />
    );
  const guard = (el: ReactNode) =>
    status === 'in' ? (
      el
    ) : status === 'out' ? (
      <Navigate to="/login" replace state={{ from: pathOf(location) }} />
    ) : (
      pending
    );

  return (
    <ToastProvider>
      <BackgroundErrorToasts />
      <SignOutProvider>
        <StudentModalProvider>
          <Routes>
            <Route
              path="/login"
              element={
                status === 'in' ? (
                  <Navigate to={fromOf(location.state) ?? '/'} replace />
                ) : status === 'out' ? (
                  <Login />
                ) : (
                  pending
                )
              }
            />
            <Route path="/" element={guard(<ClassList me={me} />)} />
            <Route path="/classes" element={guard(<ClassList me={me} />)} />
            <Route path="/classes/:id" element={guard(<ClassDetail me={me} />)} />
            <Route path="/classes/:id/students/:sid" element={guard(<StudentProfile me={me} />)} />
            <Route path="/classes/:id/sessions/:sid" element={guard(<SessionDetail me={me} />)} />
            <Route path="/classes/:id/attendance" element={guard(<ClassAttendance />)} />
            <Route path="/classes/:id/setup" element={guard(<Setup />)} />
            <Route
              path="/classes/:id/classroom"
              element={
                <LocalClassroomGuard status={status} otherwise={guard(<Classroom />)}>
                  <Classroom />
                </LocalClassroomGuard>
              }
            />
            <Route path="/sessions" element={guard(<Sessions me={me} />)} />
            <Route path="/billing" element={guard(<Billing me={me} />)} />
            <Route path="/billing/:batchId" element={guard(<BillingBatch me={me} />)} />
            <Route path="/teachers" element={guard(<Teachers me={me} />)} />
            <Route path="/admin" element={guard(<Admin me={me} />)} />
          </Routes>
        </StudentModalProvider>
      </SignOutProvider>
    </ToastProvider>
  );
}

/** 有本地进行中课堂且不是「确认未登录」时直接渲染课堂，其余交给普通守卫。 */
function LocalClassroomGuard({
  status,
  otherwise,
  children,
}: {
  status: AuthStatus;
  otherwise: ReactNode;
  children: ReactNode;
}) {
  const { id = '' } = useParams();
  const local = (status === 'loading' || status === 'error') && loadSession(id) != null;
  return <>{local ? children : otherwise}</>;
}

const centered = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  color: '#9aa1ac',
  fontSize: 13.5,
} as const;

function AuthError({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div style={centered}>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#3c4451' }}>无法读取登录状态</div>
      {message && <div>{message}</div>}
      <button
        onClick={onRetry}
        style={{
          height: 36,
          padding: '0 18px',
          border: '1px solid #e2e5ea',
          borderRadius: 9,
          background: '#fff',
          color: '#3c4451',
          fontWeight: 600,
          fontSize: 13.5,
          cursor: 'pointer',
        }}
      >
        重试
      </button>
    </div>
  );
}

function Splash() {
  return <div style={centered}>加载中…</div>;
}

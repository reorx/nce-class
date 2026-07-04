import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './components/Toast';
import { api, type Me } from './lib/api';
import { ClassDetail } from './pages/ClassDetail';
import { ClassList } from './pages/ClassList';
import { Classroom } from './pages/Classroom';
import { Login } from './pages/Login';
import { RecapPreview } from './pages/RecapPreview';
import { Setup } from './pages/Setup';
import { StudentProfile } from './pages/StudentProfile';
import { Teachers } from './pages/Teachers';

type AuthStatus = 'loading' | 'in' | 'out';

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    api
      .me()
      .then((m) => {
        setMe(m);
        setStatus('in');
      })
      .catch(() => setStatus('out'));
  }, []);

  // Everything except /login requires a live session; 401 → bounce to /login.
  const guard = (el: ReactNode) =>
    status === 'loading' ? <Splash /> : status === 'in' ? el : <Navigate to="/login" replace />;

  return (
    <ToastProvider>
      <Routes>
        <Route
          path="/login"
          element={
            status === 'loading' ? (
              <Splash />
            ) : status === 'in' ? (
              <Navigate to="/" replace />
            ) : (
              <Login
                onLogin={(m) => {
                  setMe(m);
                  setStatus('in');
                }}
              />
            )
          }
        />
        <Route path="/" element={guard(<ClassList me={me} />)} />
        <Route path="/classes/:id" element={guard(<ClassDetail me={me} />)} />
        <Route path="/classes/:id/students/:sid" element={guard(<StudentProfile me={me} />)} />
        <Route path="/classes/:id/sessions/:sid/recap" element={guard(<RecapPreview />)} />
        <Route path="/classes/:id/setup" element={guard(<Setup />)} />
        <Route path="/classes/:id/classroom" element={guard(<Classroom />)} />
        <Route path="/teachers" element={guard(<Teachers me={me} />)} />
      </Routes>
    </ToastProvider>
  );
}

function Splash() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#9aa1ac',
        fontSize: 13.5,
      }}
    >
      加载中…
    </div>
  );
}

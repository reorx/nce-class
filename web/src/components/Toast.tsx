import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type ToastType = 'success' | 'error';
interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

const ToastCtx = createContext<(message: string, type?: ToastType) => void>(() => {});

/** App-wide toast host + `useToast()` accessor. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const show = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++seq.current;
    setItems((xs) => [...xs, { id, message, type }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 2600);
  }, []);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div
        style={{
          position: 'fixed',
          top: 18,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 200,
          display: 'flex',
          flexDirection: 'column',
          gap: 9,
          alignItems: 'center',
          pointerEvents: 'none',
        }}
      >
        {items.map((t) => (
          <div
            key={t.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '11px 16px',
              borderRadius: 10,
              background: '#fff',
              border: `1px solid ${t.type === 'error' ? '#f0c9c9' : '#cfe8d7'}`,
              boxShadow: '0 10px 30px rgba(20,28,45,.16)',
              fontSize: 13.5,
              fontWeight: 600,
              color: t.type === 'error' ? '#c0392b' : '#2c7a48',
              animation: 'dc-pop .16s ease',
            }}
          >
            <span style={{ fontSize: 15, lineHeight: 1 }}>{t.type === 'error' ? '⚠️' : '✓'}</span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

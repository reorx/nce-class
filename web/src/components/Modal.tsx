import { useEffect, type ReactNode } from 'react';

/** Centered modal card over a dimmed backdrop. Closes on backdrop click + Esc. */
export function Modal({
  open,
  onClose,
  title,
  children,
  width = 420,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(20,28,45,.4)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: width,
          maxHeight: '86vh',
          overflowY: 'auto',
          background: '#fff',
          borderRadius: 15,
          boxShadow: '0 24px 60px rgba(20,28,45,.28)',
          animation: 'dc-pop .16s ease',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '17px 20px',
            borderBottom: '1px solid #eef0f3',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 16.5, color: '#1e2430' }}>{title}</div>
          <button
            onClick={onClose}
            aria-label="关闭"
            style={{
              marginLeft: 'auto',
              width: 30,
              height: 30,
              border: 'none',
              background: '#f2f4f6',
              borderRadius: 8,
              color: '#7a828f',
              fontSize: 17,
              lineHeight: 1,
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

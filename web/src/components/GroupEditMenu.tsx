import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// 动物 emoji 调色板 — 组编辑菜单里点选。6 行 × 8 列；
// 包含 lib/setup EMOJIS 的默认循环款，保证当前值总能被高亮。
export const ANIMAL_EMOJIS = [
  '🐶',
  '🐱',
  '🐭',
  '🐹',
  '🐰',
  '🦊',
  '🐻',
  '🐼',
  '🐨',
  '🐯',
  '🦁',
  '🐮',
  '🐷',
  '🐸',
  '🐵',
  '🐔',
  '🐧',
  '🐦',
  '🐤',
  '🦆',
  '🦅',
  '🦉',
  '🦇',
  '🐺',
  '🐗',
  '🐴',
  '🦄',
  '🐢',
  '🐍',
  '🦖',
  '🦕',
  '🐝',
  '🦋',
  '🐌',
  '🐞',
  '🐙',
  '🦀',
  '🐠',
  '🐬',
  '🐳',
  '🦈',
  '🐊',
  '🐘',
  '🦒',
  '🦓',
  '🦘',
  '🦥',
  '🦔',
];

const COLS = 8;
const CELL = 38;
const GAP = 4;
const PAD = 14;
const PANEL_W = COLS * CELL + (COLS - 1) * GAP + PAD * 2;
// name field + emoji grid + delete button, roughly — used only for flip-above math
const PANEL_H = Math.ceil(ANIMAL_EMOJIS.length / COLS) * (CELL + GAP) - GAP + PAD * 2 + 150;

/**
 * 组编辑菜单：点击组表头弹出 — 改 emoji / 改组名 / 删除小组。
 * Portaled to <body> with fixed positioning so the group columns'
 * overflow:hidden / scrollers never clip it. Edits apply live; the menu closes
 * on outside click / Escape / scroll, or after a confirmed delete.
 */
export function GroupEditPopover({
  anchor,
  name,
  emoji,
  memberCount,
  canDelete,
  onEmoji,
  onRename,
  onDelete,
  onClose,
}: {
  anchor: HTMLElement;
  name: string;
  emoji: string;
  memberCount: number;
  canDelete: boolean;
  onEmoji: (emoji: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos] = useState(() => {
    const r = anchor.getBoundingClientRect();
    const left = Math.max(12, Math.min(r.left, window.innerWidth - PANEL_W - 12));
    const below = r.bottom + 8;
    const top = below + PANEL_H > window.innerHeight - 12 ? Math.max(12, r.top - 8 - PANEL_H) : below;
    return { left, top };
  });

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // clicks on the anchor are the caller's toggle — don't double-close here
      if (anchor.contains(t) || panelRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onScroll = (e: Event) => {
      // scrolling anywhere else would desync the fixed panel from its anchor
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [anchor, onClose]);

  const del = () => {
    if (!window.confirm(`确定删除「${name}」？\n删除后组内 ${memberCount} 名学生将移动到未分组。`)) return;
    onDelete();
  };

  return createPortal(
    <div
      ref={panelRef}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        zIndex: 120,
        width: PANEL_W,
        padding: PAD,
        background: '#fff',
        borderRadius: 18,
        border: '2px solid #eef3e8',
        boxShadow: '0 18px 44px rgba(20,40,20,.18)',
        animation: 'pop-in .16s cubic-bezier(.2,.9,.3,1.2)',
        fontFamily: 'inherit',
      }}
    >
      <label style={{ display: 'block', fontWeight: 800, fontSize: 13, color: '#5b6672', marginBottom: 6 }}>组名</label>
      <input
        value={name}
        onChange={(e) => onRename(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onClose()}
        placeholder="小组名称"
        autoFocus
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '9px 12px',
          borderRadius: 12,
          border: '2px solid #eaefe6',
          background: '#f8faf5',
          fontSize: 16,
          fontWeight: 800,
          color: '#2c3340',
          fontFamily: 'inherit',
          outline: 'none',
          marginBottom: 12,
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = '#7fce97')}
        onBlur={(e) => (e.currentTarget.style.borderColor = '#eaefe6')}
      />

      <div style={{ fontWeight: 800, fontSize: 13, color: '#5b6672', marginBottom: 6 }}>emoji</div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${COLS}, ${CELL}px)`, gap: GAP }}>
        {ANIMAL_EMOJIS.map((em) => (
          <button
            key={em}
            onClick={() => onEmoji(em)}
            style={{
              width: CELL,
              height: CELL,
              border: 'none',
              borderRadius: 10,
              background: em === emoji ? '#eafaef' : 'transparent',
              boxShadow: em === emoji ? 'inset 0 0 0 2px #7fce97' : 'none',
              fontSize: 24,
              lineHeight: 1,
              cursor: 'pointer',
              transition: 'background .1s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#eefaf0')}
            onMouseLeave={(e) => (e.currentTarget.style.background = em === emoji ? '#eafaef' : 'transparent')}
          >
            {em}
          </button>
        ))}
      </div>

      <button
        onClick={del}
        disabled={!canDelete}
        title={canDelete ? undefined : '至少保留一个小组'}
        style={{
          marginTop: 12,
          width: '100%',
          padding: '10px 0',
          borderRadius: 12,
          border: '2px solid #ffd9da',
          background: '#fff5f5',
          color: '#e0454a',
          fontWeight: 800,
          fontSize: 14,
          fontFamily: 'inherit',
          cursor: canDelete ? 'pointer' : 'not-allowed',
          opacity: canDelete ? 1 : 0.45,
          transition: 'background .12s',
        }}
        onMouseEnter={(e) => canDelete && (e.currentTarget.style.background = '#ffecec')}
        onMouseLeave={(e) => (e.currentTarget.style.background = '#fff5f5')}
      >
        🗑 删除小组
      </button>
    </div>,
    document.body,
  );
}

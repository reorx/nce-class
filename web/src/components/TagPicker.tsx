import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MAX_TAG_LEN, normalizeTagName, tagKey } from '../lib/tags';
import { effectiveZoom, portalPanelPos } from '../lib/zoom';

const PANEL_W = 300;
const PANEL_H = 300; // rough cap (input + option list) — used only for flip-above math

/**
 * 奖章 tag 选择器：点学生浮窗的 [+] 弹出 — 从组织 tag 库点选，或输入新名字
 * 创建（真正入库发生在结束课堂的 commit upsert，这里只回传字符串）。
 * Portaled to <body> with fixed positioning（同 GroupEditPopover），外点 /
 * Escape / 滚动关闭；选中或新建后由调用方关闭本弹层、学生浮窗保持打开。
 */
export function TagPicker({
  anchor,
  options,
  onPick,
  onClose,
}: {
  anchor: HTMLElement;
  options: string[]; // 已按「库 ∪ 本课新增 − 该生已有」过滤好的候选
  onPick: (tag: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  // 课堂投屏放大：portal 在课堂根节点的 zoom 子树外，读锚点的有效 zoom 跟随缩放
  // （currentCSSZoom：Chrome/FF 126+；定位换算见 lib/zoom portalPanelPos）
  const [zoom] = useState(() => effectiveZoom(anchor));
  const [pos] = useState(() =>
    portalPanelPos(anchor.getBoundingClientRect(), { w: PANEL_W, h: PANEL_H }, zoom, {
      w: window.innerWidth,
      h: window.innerHeight,
    }),
  );

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

  const typed = normalizeTagName(q);
  const matches = options.filter((o) => !typed || o.toLowerCase().includes(typed.toLowerCase()));
  const exact = options.find((o) => tagKey(o) === tagKey(typed));
  const submit = () => typed && onPick(exact ?? typed);

  return createPortal(
    <div
      ref={panelRef}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        zoom,
        zIndex: 120,
        width: PANEL_W,
        padding: 14,
        boxSizing: 'border-box',
        background: '#fff',
        borderRadius: 18,
        border: '2px solid #eef3e8',
        boxShadow: '0 18px 44px rgba(20,40,20,.18)',
        animation: 'pop-in .16s cubic-bezier(.2,.9,.3,1.2)',
        fontFamily: 'inherit',
      }}
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        maxLength={MAX_TAG_LEN}
        placeholder="输入或筛选奖章…"
        autoFocus
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '9px 12px',
          borderRadius: 12,
          border: '2px solid #eaefe6',
          background: '#f8faf5',
          fontSize: 15,
          fontWeight: 800,
          color: '#2c3340',
          fontFamily: 'inherit',
          outline: 'none',
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = '#7fce97')}
        onBlur={(e) => (e.currentTarget.style.borderColor = '#eaefe6')}
      />

      {(matches.length > 0 || (typed && !exact)) && (
        <div
          style={{
            marginTop: 10,
            maxHeight: 190,
            overflowY: 'auto',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          {matches.map((o) => (
            <button
              key={o}
              onClick={() => onPick(o)}
              style={{
                padding: '7px 13px',
                borderRadius: 999,
                border: '1.5px solid #f2dfae',
                background: '#fff8e5',
                color: '#8f6b16',
                fontWeight: 800,
                fontSize: 14,
                fontFamily: 'inherit',
                cursor: 'pointer',
                transition: 'background .1s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#ffefc4')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#fff8e5')}
            >
              🏅 {o}
            </button>
          ))}
          {typed && !exact && (
            <button
              onClick={submit}
              style={{
                padding: '7px 13px',
                borderRadius: 999,
                border: '1.5px dashed #b6cfae',
                background: '#f4faf1',
                color: '#3f8f55',
                fontWeight: 800,
                fontSize: 14,
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              ＋ 新建「{typed}」
            </button>
          )}
        </div>
      )}
      {matches.length === 0 && !typed && (
        <div style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: '#98a2b0' }}>输入名称创建第一枚奖章</div>
      )}
    </div>,
    document.body,
  );
}

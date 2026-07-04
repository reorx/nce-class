// 投屏放大：课堂界面按 1440 宽设计，屏宽超过 1440（如 1920 投影仪）时整体 zoom，
// 等效于把 1440 布局等比铺满宽屏；封顶 1.5 防止超宽屏（如 2560×1080）纵向空间被压得太小。
export const ZOOM_BASE = 1440;
export const ZOOM_MAX = 1.5;

export function displayZoom(width: number): number {
  if (width <= ZOOM_BASE) return 1;
  return Math.min(width / ZOOM_BASE, ZOOM_MAX);
}

// 元素的有效 zoom（自身与祖先累积）。currentCSSZoom 是较新的 DOM API
// （Chrome/Edge 128+、Firefox 126+），老浏览器缺失时按未缩放处理。
export function effectiveZoom(el: HTMLElement): number {
  return (el as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom ?? 1;
}

// Portal 到 <body> 的弹层（GroupEditPopover / TagPicker）逃出了课堂根节点的 zoom 子树，
// 需要自带 zoom 样式跟随放大；此时它 fixed 定位的 left/top 会被浏览器再乘一次自身 zoom，
// 所以：锚点 getBoundingClientRect 给的是视觉坐标 → 用视觉尺寸（面板 × zoom）做贴边/翻转
// 计算，最后 ÷ zoom 换算回面板自身坐标系。zoom=1 时退化为原始逻辑。
export function portalPanelPos(
  anchor: { left: number; top: number; bottom: number },
  panel: { w: number; h: number },
  zoom: number,
  viewport: { w: number; h: number },
): { left: number; top: number } {
  const w = panel.w * zoom;
  const h = panel.h * zoom;
  const left = Math.max(12, Math.min(anchor.left, viewport.w - w - 12));
  const below = anchor.bottom + 8;
  const top = below + h > viewport.h - 12 ? Math.max(12, anchor.top - 8 - h) : below;
  return { left: left / zoom, top: top / zoom };
}

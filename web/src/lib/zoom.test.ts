import { describe, expect, it } from 'vitest';
import { displayZoom, portalPanelPos, ZOOM_BASE, ZOOM_MAX } from './zoom';

describe('displayZoom', () => {
  it('1440 及以下不缩放', () => {
    expect(displayZoom(1280)).toBe(1);
    expect(displayZoom(ZOOM_BASE)).toBe(1);
  });

  it('超过 1440 按 宽度/1440 等比放大（1920 投屏 ≈ 1.333）', () => {
    expect(displayZoom(1600)).toBeCloseTo(1600 / 1440, 5);
    expect(displayZoom(1920)).toBeCloseTo(1920 / 1440, 5);
  });

  it('超宽屏封顶 ZOOM_MAX，避免过度放大', () => {
    expect(displayZoom(2560)).toBe(ZOOM_MAX);
    expect(displayZoom(3840)).toBe(ZOOM_MAX);
  });
});

describe('portalPanelPos（portal 弹层带 zoom 时的 fixed 定位）', () => {
  const panel = { w: 300, h: 300 };
  const vp = { w: 1440, h: 900 };

  it('zoom=1 时与原逻辑一致：锚点左对齐、下方 8px', () => {
    const r = { left: 100, top: 200, bottom: 240 };
    expect(portalPanelPos(r, panel, 1, vp)).toEqual({ left: 100, top: 248 });
  });

  it('zoom=1 下方放不下时翻转到锚点上方', () => {
    const r = { left: 100, top: 700, bottom: 740 };
    expect(portalPanelPos(r, panel, 1, vp)).toEqual({ left: 100, top: 700 - 8 - 300 });
  });

  it('zoom=1 右缘裁剪：left 收进 12px 边距内', () => {
    const r = { left: 1400, top: 200, bottom: 240 };
    expect(portalPanelPos(r, panel, 1, vp)).toEqual({ left: 1440 - 300 - 12, top: 248 });
  });

  it('zoom>1 时坐标换算到面板自身坐标系（视觉位置 ÷ zoom）', () => {
    const r = { left: 100, top: 200, bottom: 240 };
    const z = 4 / 3;
    const got = portalPanelPos(r, panel, z, { w: 1920, h: 1080 });
    expect(got.left).toBeCloseTo(100 / z, 5);
    expect(got.top).toBeCloseTo(248 / z, 5);
  });

  it('zoom>1 时裁剪/翻转按放大后的视觉尺寸计算', () => {
    const z = 4 / 3;
    // 面板视觉宽 400：left 1600 会超出 1920-12 → 收到 1920-400-12=1508（再 ÷z 成面板坐标）
    const clamped = portalPanelPos({ left: 1600, top: 200, bottom: 240 }, panel, z, { w: 1920, h: 1080 });
    expect(clamped.left).toBeCloseTo((1920 - 400 - 12) / z, 5);
    // 面板视觉高 400：bottom 740 下方需要 748+400 > 1080-12 → 翻转到上方 700-8-400=292
    const flipped = portalPanelPos({ left: 100, top: 700, bottom: 740 }, panel, z, { w: 1920, h: 1080 });
    expect(flipped.top).toBeCloseTo((700 - 8 - 400) / z, 5);
  });
});

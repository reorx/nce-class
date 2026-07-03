import type { CSSProperties } from 'react';
import type { StudentStatus } from './api';

export const GREEN = '#2fb457';
export const GREEN_DARK = '#279a49';

// Avatar palette (matches the design mockups).
export const PAL = [
  { bg: '#eef1f5', fg: '#5b6472' },
  { bg: '#e9f1ec', fg: '#3f7a56' },
  { bg: '#eef0f8', fg: '#586099' },
  { bg: '#f4eee9', fg: '#8a6b52' },
  { bg: '#f0eef6', fg: '#6b5f8a' },
  { bg: '#eaf0f2', fg: '#4d7385' },
];

export function initial(name: string): string {
  return name ? name[0] : '?';
}

/** Deterministic palette index from a stable key. */
export function palIndex(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % PAL.length;
}

/** Circular student avatar; dashed placeholder when there is no photo. */
export function avatarStyle(key: string, size: number, hasPhoto = true): CSSProperties {
  const fs = size >= 44 ? 18 : size >= 34 ? 14 : 13;
  if (!hasPhoto) {
    return {
      width: size,
      height: size,
      borderRadius: '50%',
      background: '#f2f4f6',
      color: '#aab1bc',
      border: '1.5px dashed #cfd4db',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 600,
      fontSize: fs,
      flexShrink: 0,
    };
  }
  const p = PAL[palIndex(key)];
  return {
    width: size,
    height: size,
    borderRadius: '50%',
    background: p.bg,
    color: p.fg,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 600,
    fontSize: fs,
    flexShrink: 0,
  };
}

// ---- student badges (shared by 班级详情 roster cards + 成长档案 header) -------

export function sourceTag(source: 'parent' | 'teacher') {
  return source === 'parent'
    ? { label: '家长自助', color: '#586099', bg: '#eef0f8' }
    : { label: '老师添加', color: '#6b7280', bg: '#f0f2f5' };
}

/** Status badge; null for active (no badge shown). */
export function statusTag(status: StudentStatus) {
  if (status === 'suspended') return { label: '停课', color: '#b06c22', bg: '#fdf3e5' };
  if (status === 'archived') return { label: '已归档', color: '#7a828f', bg: '#f0f2f5' };
  return null;
}

/** Rounded-square avatar used for teacher rows. */
export function squareAvatarStyle(key: string, size: number): CSSProperties {
  const p = PAL[palIndex(key)];
  return {
    width: size,
    height: size,
    borderRadius: 9,
    background: p.bg,
    color: p.fg,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 600,
    fontSize: 14,
    flexShrink: 0,
  };
}

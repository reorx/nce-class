// Pure derivations for the 学生成长档案 matrix (成长档案 §7.4).
// The 课堂得分 row doubles as the trend visual: each attended cell gets a mini
// bar scaled against the student's own max magnitude, positive up / negative
// down from a shared zero line (same math as the design mockup, miniaturised).

export interface BarGeom {
  bottom: number;
  height: number;
  positive: boolean;
}

/** Per-column bar geometry; null entries (absent / 未入班) yield null bars. */
export function barGeometry(nets: (number | null)[], H: number): { zero: number; bars: (BarGeom | null)[] } {
  const known = nets.filter((n): n is number => n != null);
  const maxPos = Math.max(0, ...known);
  const maxNeg = Math.max(0, ...known.map((n) => -n));
  const range = maxPos + maxNeg || 1;
  const zero = Math.round((maxNeg / range) * H);
  const bars = nets.map((n) => {
    if (n == null) return null;
    const h = Math.max(Math.round((Math.abs(n) / range) * H), 2);
    return n >= 0 ? { bottom: zero, height: h, positive: true } : { bottom: zero - h, height: h, positive: false };
  });
  return { zero, bars };
}

export const netLabel = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export const netColor = (n: number) => (n > 0 ? '#2c8a4f' : n < 0 ? '#c14a4a' : '#9aa1ac');

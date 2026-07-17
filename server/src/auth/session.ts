import { createHmac, timingSafeEqual } from 'node:crypto';

// Stateless signed-session cookie (PRD §4). Token = `teacherId.exp.hmac`, where
// hmac = HMAC-SHA256(`teacherId.exp`, AUTH_SECRET). No session table needed.
export const SESSION_COOKIE = 'nce_session';
const MAX_AGE_SEC = 7 * 24 * 60 * 60; // 7 days
// 生产环境必须显式配置 AUTH_SECRET：仓库公开后 fallback 值人人可见，漏配即可伪造会话。
if (process.env.NODE_ENV === 'production' && !process.env.AUTH_SECRET) {
  throw new Error('AUTH_SECRET must be set in production (openssl rand -hex 32)');
}
const SECRET = process.env.AUTH_SECRET || 'nce-dev-insecure-secret-change-me';

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('hex');
}

/** Issue a token valid for 7 days from `nowSec` (seconds since epoch). */
export function signSession(teacherId: string, nowSec: number): string {
  const exp = nowSec + MAX_AGE_SEC;
  const payload = `${teacherId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

/** Return the teacherId if the token is well-formed, unexpired and untampered. */
export function verifySession(token: string | undefined, nowSec: number): string | null {
  return verifyToken(token, nowSec, '');
}

// wx Bearer tokens reuse the HMAC scheme but sign a domain-prefixed payload,
// so a teacher cookie can never pass as a wx token (nor the reverse).

/** Issue a miniapp Bearer token (subject = wechatAccountId), 7-day expiry. */
export function signWxToken(accountId: string, nowSec: number): string {
  const exp = nowSec + MAX_AGE_SEC;
  const payload = `${accountId}.${exp}`;
  return `${payload}.${sign(`wx:${payload}`)}`;
}

/** Return the wechatAccountId if the Bearer token is valid and unexpired. */
export function verifyWxToken(token: string | undefined, nowSec: number): string | null {
  return verifyToken(token, nowSec, 'wx:');
}

function verifyToken(token: string | undefined, nowSec: number, domain: string): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [subject, expStr, mac] = parts;
  const exp = Number(expStr);
  if (!subject || !Number.isFinite(exp) || exp <= nowSec) return null;
  const expected = sign(`${domain}${subject}.${expStr}`);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return subject;
}

/** Parse a raw `Cookie:` header into a name→value map. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const name = pair.slice(0, idx).trim();
    if (name) out[name] = decodeURIComponent(pair.slice(idx + 1).trim());
  }
  return out;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${MAX_AGE_SEC}; SameSite=Lax`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

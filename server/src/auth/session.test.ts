import { describe, expect, it } from 'vitest';
import { parseCookies, signSession, verifySession } from './session.js';

describe('signed session token', () => {
  const NOW = 1_700_000_000; // fixed reference (seconds)

  it('round-trips a valid, unexpired token', () => {
    const token = signSession('t-wangli', NOW);
    expect(verifySession(token, NOW + 60)).toBe('t-wangli');
  });

  it('rejects an expired token', () => {
    const token = signSession('t-wangli', NOW);
    expect(verifySession(token, NOW + 8 * 24 * 60 * 60)).toBeNull();
  });

  it('rejects a tampered token (changed teacherId or mac)', () => {
    const token = signSession('t-wangli', NOW);
    const [, exp, mac] = token.split('.');
    expect(verifySession(`t-attacker.${exp}.${mac}`, NOW + 60)).toBeNull();
    expect(verifySession(`t-wangli.${exp}.deadbeef`, NOW + 60)).toBeNull();
  });

  it('rejects malformed / empty tokens', () => {
    expect(verifySession(undefined, NOW)).toBeNull();
    expect(verifySession('', NOW)).toBeNull();
    expect(verifySession('only.two', NOW)).toBeNull();
  });
});

describe('parseCookies', () => {
  it('parses a multi-pair cookie header', () => {
    expect(parseCookies('a=1; nce_session=t-wangli.123.abc; b=2')).toEqual({
      a: '1',
      nce_session: 't-wangli.123.abc',
      b: '2',
    });
  });

  it('returns {} for a missing header', () => {
    expect(parseCookies(undefined)).toEqual({});
  });
});

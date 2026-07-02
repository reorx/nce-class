// WeChat code2session, with a deterministic local stub for appid-less dev:
// WX_MOCK=1 maps code `mock:<name>` → openid `mock-openid-<name>`, so the h5
// build and tests can drive all three roles without WeChat servers. With a
// real appid, set WX_APPID/WX_SECRET and leave WX_MOCK unset.
export interface WxIdentity {
  openid: string;
  unionid: string | null;
}

export async function code2session(code: string): Promise<WxIdentity | null> {
  if (process.env.WX_MOCK === '1') {
    const m = /^mock:([\w-]+)$/.exec(code);
    return m ? { openid: `mock-openid-${m[1]}`, unionid: null } : null;
  }
  const appid = process.env.WX_APPID;
  const secret = process.env.WX_SECRET;
  if (!appid || !secret) return null;
  const url =
    `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}` +
    `&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const res = await fetch(url);
  const data = (await res.json()) as { openid?: string; unionid?: string; errcode?: number };
  if (!data.openid) return null;
  return { openid: data.openid, unionid: data.unionid ?? null };
}

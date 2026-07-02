import Taro from '@tarojs/taro';
import { ApiError, getWxMe, setAuthToken, wxLogin, type WxMe } from './api';
import { mockLoginCode } from './flow';

// wx 会话粘合层：token 存 storage、启动时静默登录。h5 端没有 wx.login，用
// storage 里的 mock 名（nce.mockUser，默认 dev-new）走服务端 WX_MOCK stub。
const TOKEN_KEY = 'nce.wxToken';
const MOCK_KEY = 'nce.mockUser';
const CHILD_KEY = 'nce.currentChild';

async function loginCode(): Promise<string> {
  const mockName = Taro.getStorageSync(MOCK_KEY);
  if (process.env.TARO_ENV === 'h5') return mockLoginCode(mockName);
  // weapp 开发者工具（touristappid 的游客 code 过不了 code2session）：storage 里
  // 放了 mock 名就走 WX_MOCK stub；没放则走真 wx.login（正式 appid 路径）。
  if (mockName) return mockLoginCode(mockName);
  const res = await Taro.login();
  return res.code;
}

/** 静默登录：优先复用存量 token（401 才重新 wx.login），返回 me。 */
export async function ensureLogin(): Promise<WxMe> {
  const stored = Taro.getStorageSync(TOKEN_KEY);
  if (stored) {
    setAuthToken(stored);
    try {
      return await getWxMe();
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) throw e;
    }
  }
  const r = await wxLogin(await loginCode());
  Taro.setStorageSync(TOKEN_KEY, r.token);
  setAuthToken(r.token);
  return r.me;
}

// 「当前选中的孩子」只记 studentId；孩子列表本身由服务端 bindings 派生。
export const loadCurrentChildId = (): string | null => Taro.getStorageSync(CHILD_KEY) || null;
export const saveCurrentChildId = (id: string): void => Taro.setStorageSync(CHILD_KEY, id);

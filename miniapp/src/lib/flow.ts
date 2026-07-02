// 首页分流 / 登录 code / join 表单校验的纯逻辑 — 不碰 Taro API（storage 粘合在
// wxAuth.ts），方便 vitest 直接测。

import type { WxChild, WxMe } from './api';

/** h5 无 wx.login：用本地 mock 名拼确定性 code（服务端 WX_MOCK=1 放行）。 */
export function mockLoginCode(mockName: unknown): string {
  const name = typeof mockName === 'string' && mockName.trim() ? mockName.trim() : 'dev-new';
  return `mock:${name}`;
}

/** index 页按 me 分流：老师 > 有孩子 > 有待确认申请 > 欢迎页。 */
export type HomeRoute = 'teacher' | 'children' | 'pending' | 'welcome';

export function routeForMe(me: WxMe): HomeRoute {
  if (me.teacher) return 'teacher';
  if (me.children.length > 0) return 'children';
  if (me.pending.length > 0) return 'pending';
  return 'welcome';
}

/** 多孩切换：命中记忆的 studentId 用它，否则回退第一个孩子。 */
export function pickChild(children: WxChild[], storedId: unknown): WxChild | null {
  if (children.length === 0) return null;
  return children.find((c) => c.studentId === storedId) ?? children[0];
}

/** join 表单校验；返回错误文案，null = 通过。手机号 11 位、1 开头，可留空。 */
export function validateJoinForm(form: { cnName: string; parentPhone: string }): string | null {
  if (!form.cnName.trim()) return '请填写孩子的中文名';
  const phone = form.parentPhone.trim();
  if (phone && !/^1\d{10}$/.test(phone)) return '手机号需为 11 位数字';
  return null;
}

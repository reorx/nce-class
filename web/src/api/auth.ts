import { get, request, type RequestOptions } from './client';

export interface Me {
  id: string;
  name: string;
  username: string;
  role: string;
  isAdmin: boolean; // 管理员 → 顶导「管理」入口；/api/admin/* 由服务端强制鉴权
  orgName: string;
}

export const getMe = (options?: RequestOptions) => get<Me>('/api/me', options);

/** 密码错误 → 401（不是会话过期）。 */
export const login = (username: string, password: string) =>
  request<Me>('POST', '/api/auth/login', { username, password });

export const logout = () => request<{ ok: true }>('POST', '/api/auth/logout');

/** 危险操作前复核当前老师的密码；不匹配 → 403，会话仍有效。 */
export const verifyPassword = (password: string) =>
  request<{ ok: true }>('POST', '/api/auth/verify-password', { password });

import Taro from '@tarojs/taro';

// h5 走 devServer 代理（相对路径）；weapp 直连本机 server（开发者工具需关闭域名校验）。
export const BASE = process.env.TARO_ENV === 'h5' ? '' : 'http://localhost:5177';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, data?: unknown): Promise<T> {
  const res = await Taro.request({
    url: `${BASE}${path}`,
    method,
    data: data as any,
    header: { 'Content-Type': 'application/json' },
  });
  if (res.statusCode >= 400) throw new ApiError(res.statusCode, (res.data as any)?.error ?? `HTTP ${res.statusCode}`);
  return res.data as T;
}

// ---- payload types（与 server /api/parent/* 对齐）----
export interface ClassPreview {
  className: string;
  level: string | null;
  teacherName: string;
  orgName: string;
  studentCount: number;
}

export interface JoinResult {
  studentId: string;
  recapToken: string;
  name: string;
  className: string;
}

export interface SessionBrief {
  id: string;
  date: string; // MM-DD
  year: string;
  weekday: string;
  lessonNumber: number | null;
  lessonTitle: string | null;
}

export interface MePayload {
  student: { id: string; name: string; photoUrl: string | null };
  class: { id: string; name: string; level: string | null; teacherName: string; orgName: string };
  sessions: SessionBrief[];
  latestSessionId: string | null;
}

export interface RecapGroup {
  id: string;
  name: string;
  emoji: string | null;
  score: number;
  mine: boolean;
}

export interface Mine {
  attended: boolean;
  groupName: string | null;
  groupEmoji: string | null;
  personalScore: number;
  homework: string;
  recitation: string;
}

export interface ParentRecap {
  date: string;
  weekday: string;
  lessonNumber: number | null;
  lessonTitle: string | null;
  actualDurationMin: number;
  attendancePresent: number;
  attendanceTotal: number;
  groups: RecapGroup[];
  stars: { name: string; net: number }[];
  warned: { name: string }[];
  mine: Mine | null;
}

// ---- endpoints ----
export const getJoinPreview = (code: string) => request<ClassPreview>('GET', `/api/parent/join/${code}`);

export const joinClass = (code: string, body: { name: string; photoKey?: string }) =>
  request<JoinResult>('POST', `/api/parent/join/${code}`, body);

export async function uploadPhoto(code: string, filePath: string): Promise<{ key: string; url: string }> {
  const res = await Taro.uploadFile({ url: `${BASE}/api/parent/join/${code}/photo`, filePath, name: 'photo' });
  if (res.statusCode >= 400) throw new ApiError(res.statusCode, `上传失败 HTTP ${res.statusCode}`);
  return JSON.parse(res.data);
}

export const getMe = (token: string) => request<MePayload>('GET', `/api/parent/me/${token}`);

export const getRecap = (token: string, sessionId: string) =>
  request<ParentRecap>('GET', `/api/parent/me/${token}/sessions/${sessionId}`);

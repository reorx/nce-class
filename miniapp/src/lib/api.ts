import Taro from '@tarojs/taro';

// h5 走 devServer 代理（相对路径）；weapp 开发构建（dev:weapp --watch）直连本机 server
// （开发者工具需关闭域名校验），正式构建（build:weapp）指向生产域名——mp 后台须配好
// request/uploadFile/downloadFile 三类合法域名 = https://service.domain。
export const BASE =
  process.env.TARO_ENV === 'h5'
    ? ''
    : process.env.NODE_ENV === 'production'
      ? 'https://service.domain'
      : 'http://localhost:5177';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// wx 会话是 Bearer token（不是 cookie）：登录后 setAuthToken，之后每个请求带上。
let authToken: string | null = null;
export function setAuthToken(token: string | null) {
  authToken = token;
}
const authHeader = (): Record<string, string> => (authToken ? { Authorization: `Bearer ${authToken}` } : {});

async function request<T>(method: 'GET' | 'POST', path: string, data?: unknown): Promise<T> {
  const res = await Taro.request({
    url: `${BASE}${path}`,
    method,
    data: data as any,
    header: { 'Content-Type': 'application/json', ...authHeader() },
  });
  if (res.statusCode >= 400) throw new ApiError(res.statusCode, (res.data as any)?.error ?? `HTTP ${res.statusCode}`);
  return res.data as T;
}

// ---- payload types（与 server /api/wx/* 对齐）----
export interface WxAccount {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
}

export interface WxTeacher {
  id: string;
  name: string;
  username: string;
  orgName: string;
}

export interface WxChild {
  studentId: string;
  name: string;
  photoUrl: string | null;
  classId: string;
  className: string;
}

export interface WxPending {
  id: string;
  classId: string;
  className: string;
  cnName: string;
}

export interface WxMe {
  account: WxAccount;
  teacher: WxTeacher | null;
  children: WxChild[];
  pending: WxPending[];
}

export interface ClassPreview {
  className: string;
  level: string | null;
  teacherName: string;
  orgName: string;
  studentCount: number;
}

export interface TeacherClass {
  id: string;
  name: string;
  level: string | null;
  studentCount: number;
  pendingCount: number;
}

export interface InviteResult {
  token: string;
  expiresAt: string;
  sharePath: string;
}

export interface JoinRequestItem {
  id: string;
  cnName: string;
  enName: string | null;
  parentPhone: string | null;
  photoUrl: string | null;
  nickname: string | null;
  createdAt: string;
}

export interface LinkableStudent {
  id: string;
  name: string;
  enName: string | null;
  hasPhoto: boolean;
  linked: boolean;
}

export interface SessionBrief {
  id: string;
  date: string; // MM-DD
  year: string;
  weekday: string;
  lessonNumber: number | null;
  lessonTitle: string | null;
}

export interface StudentHome {
  student: { id: string; name: string; enName: string | null; photoUrl: string | null };
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
  tags?: string[]; // 奖章；optional 容忍旧服务端（读侧 `?? []`）
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
  studentTags?: { name: string; tags: string[] }[]; // 奖章（班级级）；optional 同上
  mine: Mine | null;
}

// ---- 会话/身份 ----
export const wxLogin = (code: string) => request<{ token: string; me: WxMe }>('POST', '/api/wx/login', { code });

export const getWxMe = () => request<WxMe>('GET', '/api/wx/me');

export const bindTeacher = (username: string, password: string) =>
  request<WxMe>('POST', '/api/wx/bind-teacher', { username, password });

// ---- 老师侧 ----
export const getTeacherClasses = () => request<TeacherClass[]>('GET', '/api/wx/teacher/classes');

export const createInvite = (classId: string) =>
  request<InviteResult>('POST', `/api/wx/teacher/classes/${classId}/invites`);

export const getJoinRequests = (classId: string) =>
  request<JoinRequestItem[]>('GET', `/api/wx/teacher/classes/${classId}/join-requests`);

export const getClassStudents = (classId: string) =>
  request<LinkableStudent[]>('GET', `/api/wx/teacher/classes/${classId}/students`);

export const linkJoinRequest = (requestId: string, studentId: string) =>
  request<{ ok: true }>('POST', `/api/wx/join-requests/${requestId}/link`, { studentId });

export const dismissJoinRequest = (requestId: string) =>
  request<{ ok: true }>('POST', `/api/wx/join-requests/${requestId}/dismiss`);

// ---- 家长侧 ----
export const getInvitePreview = (inviteToken: string) => request<ClassPreview>('GET', `/api/wx/invites/${inviteToken}`);

export const joinByInvite = (
  inviteToken: string,
  body: { cnName: string; enName?: string; parentPhone?: string; photoKey?: string },
) =>
  request<{ id: string; classId: string; className: string; status: string }>(
    'POST',
    `/api/wx/invites/${inviteToken}/join`,
    body,
  );

export async function uploadPhoto(filePath: string): Promise<{ key: string; url: string }> {
  const res = await Taro.uploadFile({
    url: `${BASE}/api/wx/upload/photo`,
    filePath,
    name: 'photo',
    header: authHeader(),
  });
  if (res.statusCode >= 400) throw new ApiError(res.statusCode, `上传失败 HTTP ${res.statusCode}`);
  return JSON.parse(res.data);
}

export const getStudentHome = (studentId: string) => request<StudentHome>('GET', `/api/wx/students/${studentId}`);

export const getStudentRecap = (studentId: string, sessionId: string) =>
  request<ParentRecap>('GET', `/api/wx/students/${studentId}/sessions/${sessionId}`);

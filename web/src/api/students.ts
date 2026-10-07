import { get, request, type RequestOptions } from './client';

export type StudentStatus = 'active' | 'suspended' | 'archived';

export interface Student {
  id: string;
  name: string; // 英文名 — 主显示名
  cnName: string | null; // 中文名 — 卡片/收款单下方小字
  source: 'parent' | 'teacher';
  status: StudentStatus;
  hasPhoto: boolean;
  score: number;
  groupId: string | null;
}

/** 学生写接口的响应形状（服务端 studentItem）—— 班级详情的 Student 去掉派生的 score/groupId。 */
export type StudentBasic = Pick<Student, 'id' | 'name' | 'cnName' | 'source' | 'status' | 'hasPhoto'>;

// ---- student growth profile (§7.4, read-only) ------------------------------

/** One matrix cell; null when the student had no membership row (未入班). */
export interface ProfileMine {
  attended: boolean;
  groupName: string | null;
  groupEmoji: string | null;
  groupScore: number | null;
  personalScore: number;
  homework: string; // '完成' | '没交' (missing record = 没交)
  recitation: string; // '已背完' | '背完部分' | '没背' | '未检查' (missing record = 未检查)
}

export interface ProfileSession {
  id: string;
  date: string;
  year: string;
  weekday: string;
  lessonNumber: number | null;
  lessonTitle: string | null;
  mine: ProfileMine | null;
}

export interface StudentProfile {
  student: {
    id: string;
    name: string;
    cnName: string | null;
    source: 'parent' | 'teacher';
    status: StudentStatus;
    photoUrl: string | null;
  };
  class: { id: string; name: string };
  currentGroup: { name: string; emoji: string | null } | null;
  totals: { attended: number; personalTotal: number; plus: number; minus: number };
  sessions: ProfileSession[]; // ended sessions, oldest → newest
}

/** cnName 不传 = 保持原中文名（服务端按 key 是否存在判定），传空串才清空。 */
export interface StudentInput {
  name: string;
  cnName?: string | null;
}

export const createStudent = (classId: string, input: StudentInput) =>
  request<StudentBasic & { score: number }>('POST', `/api/classes/${classId}/students`, input);

export const updateStudent = (id: string, input: StudentInput) =>
  request<StudentBasic>('PUT', `/api/students/${id}`, input);

/** 硬删：连带该生的上课记录行与收款单。 */
export const deleteStudent = (id: string) => request<{ ok: true }>('DELETE', `/api/students/${id}`);

/** 非 active 会被服务端移出默认分组。 */
export const updateStudentStatus = (id: string, status: StudentStatus) =>
  request<StudentBasic>('PUT', `/api/students/${id}/status`, { status });

export const getStudentProfile = (studentId: string, options?: RequestOptions) =>
  get<StudentProfile>(`/api/students/${studentId}/profile`, options);

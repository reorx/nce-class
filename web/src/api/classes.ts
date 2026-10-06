import type { BookKey } from '../lib/homework';
import { get, request, type RequestOptions } from './client';
import type { LastRecap, Session } from './sessions';
import type { Student } from './students';

export interface ClassListItem {
  id: string;
  name: string;
  teacherName: string;
  textbook: BookKey | null; // 教材 key（lib/homework BOOKS）
  isArchived: boolean; // 已归档：首页不显示，只在 /classes?is_archived=true（lib/classList）
  studentCount: number;
  roster: string[];
  lastSession: {
    id: string;
    date: string;
    weekday: string;
    relative: string;
    lessonNumber: number | null;
    lessonTitle: string | null;
    startedAt: string | null;
    endedAt: string | null;
  } | null;
}

export interface Group {
  id: string;
  name: string;
  emoji: string | null;
  orderIndex: number;
  memberIds: string[];
}

export interface ClassDetail {
  id: string;
  name: string;
  notes: string | null; // 班级资源 — free-form markdown
  textbook: BookKey | null; // 教材 key (structured, 课文复习默认)
  isArchived: boolean; // 已归档：禁止新建课程周期和收款项
  homeworkTemplate: string | null; // 作业模板 with {lesson_number}/{date}/{class_name} vars
  teacherId: string | null; // 负责老师; null on legacy rows
  teacherName: string;
  studentCount: number;
  groupCount: number;
  sessionCount: number;
  students: Student[];
  groups: Group[];
  sessions: Session[];
  lastRecap: LastRecap | null;
}

/** A group as sent to the default-grouping save endpoint (replace semantics). */
export interface GroupSave {
  id?: string | null;
  name: string;
  emoji: string | null;
  orderIndex: number;
  memberIds: string[];
}

export interface CreateClassInput {
  name: string;
  teacherId: string;
  textbook: BookKey | null;
}

/** isArchived 不传 = 保持原归档状态。 */
export interface UpdateClassInput extends CreateClassInput {
  isArchived?: boolean;
}

export const listClasses = (options?: RequestOptions) => get<ClassListItem[]>('/api/classes', options);

export const getClass = (id: string, options?: RequestOptions) => get<ClassDetail>(`/api/classes/${id}`, options);

// 以下写接口均返回完整 ClassDetail（与 GET 同形）。
export const createClass = (input: CreateClassInput) => request<ClassDetail>('POST', '/api/classes', input);

export const updateClass = (classId: string, input: UpdateClassInput) =>
  request<ClassDetail>('PUT', `/api/classes/${classId}`, input);

export const saveClassGrouping = (classId: string, groups: GroupSave[]) =>
  request<ClassDetail>('PUT', `/api/classes/${classId}/groups`, { groups });

export const updateClassNotes = (classId: string, notes: string) =>
  request<ClassDetail>('PUT', `/api/classes/${classId}/notes`, { notes });

export const updateHomeworkTemplate = (classId: string, template: string) =>
  request<ClassDetail>('PUT', `/api/classes/${classId}/homework-template`, { template });

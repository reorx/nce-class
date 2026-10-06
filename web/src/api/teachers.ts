import { get, request, type RequestOptions } from './client';

export interface TeacherItem {
  id: string;
  name: string;
  username: string;
  role: string;
  isAdmin: boolean;
}

export const listTeachers = (options?: RequestOptions) => get<TeacherItem[]>('/api/teachers', options);

// 仅改名（username 不可改）；添加老师、改密只在 /admin（改密另有 reset-password CLI），带密码会被 403。
export const updateTeacher = (id: string, input: { name: string }) =>
  request<TeacherItem>('PUT', `/api/teachers/${id}`, input);

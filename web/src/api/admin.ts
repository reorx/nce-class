import { get, request, type RequestOptions } from './client';
import type { TeacherItem } from './teachers';

// 管理员（/admin）：服务端按 is_admin 强制鉴权；删除班级、改密同请求复核管理员自己的密码（错误 → 403），
// 添加老师只过 gate。

/** /admin 删除班级列表的一行：删除该班会一并硬删的数据量（GET /api/admin/classes）。 */
export interface AdminClassItem {
  id: string;
  name: string;
  teacherName: string;
  studentCount: number; // 不分状态：在读/停课/归档都会被删
  sessionCount: number;
  scheduleCount: number;
  batchCount: number;
  invoiceCount: number;
  paidInvoiceCount: number; // 已确认收款的收款单
  paidAmountCents: number;
}

export interface CreateTeacherInput {
  name: string;
  username: string;
  password: string;
}

export const listAdminClasses = (options?: RequestOptions) => get<AdminClassItem[]>('/api/admin/classes', options);

export const createAdminTeacher = (input: CreateTeacherInput) =>
  request<TeacherItem>('POST', '/api/admin/teachers', input);

export const deleteAdminClass = (classId: string, adminPassword: string) =>
  request<{ ok: true }>('DELETE', `/api/admin/classes/${classId}`, { adminPassword });

export const resetAdminTeacherPassword = (teacherId: string, password: string, adminPassword: string) =>
  request<{ ok: true }>('PUT', `/api/admin/teachers/${teacherId}/password`, { password, adminPassword });

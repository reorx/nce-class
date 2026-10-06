import { get, request, type RequestOptions } from './client';

// ---- 排班 (课程周期) ----

export interface ScheduleLessonItem {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
}

export interface ScheduleItem {
  id: string;
  name: string;
  createdAt: string;
  lessonCount: number;
  minDate: string | null; // 派生自节次 min/max，无节次为 null
  maxDate: string | null;
  batchId: string | null; // 已生成的收款批次（1:1）
}

export interface ScheduleDetail extends ScheduleItem {
  lessons: ScheduleLessonItem[];
}

export type ScheduleLessonInput = Omit<ScheduleLessonItem, 'id'>;

export const listSchedules = (classId: string, options?: RequestOptions) =>
  get<ScheduleItem[]>(`/api/classes/${classId}/schedules`, options);

export const getSchedule = (id: string, options?: RequestOptions) =>
  get<ScheduleDetail>(`/api/schedules/${id}`, options);

// 写接口返回完整 ScheduleDetail（与 GET 同形）。归档班级新建 → 409。
export const createSchedule = (classId: string, input: { name: string; lessons: ScheduleLessonInput[] }) =>
  request<ScheduleDetail>('POST', `/api/classes/${classId}/schedules`, input);

export const updateSchedule = (id: string, input: { name?: string; lessons?: ScheduleLessonInput[] }) =>
  request<ScheduleDetail>('PUT', `/api/schedules/${id}`, input);

/** 已生成收款批次 → 409。 */
export const deleteSchedule = (id: string) => request<{ ok: true }>('DELETE', `/api/schedules/${id}`);

import { get, type RequestOptions } from './client';

/** A pending miniapp join request (read-only here; handled inside the miniapp). */
export interface JoinRequestItem {
  id: string;
  cnName: string;
  enName: string | null;
  parentPhone: string | null;
  photoUrl: string | null;
  nickname: string | null;
  createdAt: string;
}

export const listJoinRequests = (classId: string, options?: RequestOptions) =>
  get<JoinRequestItem[]>(`/api/classes/${classId}/join-requests`, options);

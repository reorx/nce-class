export interface Me {
  id: string;
  name: string;
  username: string;
  role: string;
  orgName: string;
}

export interface ClassListItem {
  id: string;
  name: string;
  level: string | null;
  teacherName: string;
  studentCount: number;
  roster: string[];
  lastSession: { date: string; weekday: string; relative: string } | null;
}

export interface Student {
  id: string;
  name: string;
  source: 'parent' | 'teacher';
  hasPhoto: boolean;
  score: number;
  groupId: string | null;
}

export interface Group {
  id: string;
  name: string;
  emoji: string | null;
  orderIndex: number;
  memberIds: string[];
}

export interface Session {
  id: string;
  date: string;
  year: string;
  weekday: string;
  lessonNumber: number | null;
  lessonTitle: string | null;
  plannedDurationMin: number;
  actualDurationMin: number;
  durationLabel: string;
  groupCount: number;
}

export interface RecapGroup {
  name: string;
  emoji: string | null;
  orderIndex: number;
  score: number;
}

export interface LastRecap {
  date: string;
  weekday: string;
  lessonNumber: number | null;
  lessonTitle: string | null;
  actualDurationMin: number;
  attendancePresent: number;
  attendanceTotal: number;
  groups: RecapGroup[];
}

export interface ClassDetail {
  id: string;
  name: string;
  level: string | null;
  teacherName: string;
  studentCount: number;
  groupCount: number;
  sessionCount: number;
  inviteLink: string;
  students: Student[];
  groups: Group[];
  sessions: Session[];
  lastRecap: LastRecap | null;
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
}

export const api = {
  me: () => get<Me>('/api/me'),
  classes: () => get<ClassListItem[]>('/api/classes'),
  classDetail: (id: string) => get<ClassDetail>(`/api/classes/${id}`),
};

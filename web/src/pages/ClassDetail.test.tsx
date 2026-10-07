// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createQueryClient } from '../queries/client';
import { authKeys, billingKeys, classKeys, sessionKeys, studentKeys, teacherKeys } from '../queries/keys';
import { renderApp } from '../test-utils/app';
import { deferred, installFakeFetch, json, type FakeServer } from '../test-utils/fakeFetch';
import {
  batchDetail,
  classDetail,
  classListItem,
  me,
  profile,
  sessionDetail,
  student,
  teacher,
} from '../test-utils/fixtures';

// 批次 C：班级列表 / 详情（学生、分组、资源、模板、邀请）、学生弹窗、成长档案、老师。编号对应 Plan 2。

let server: FakeServer;
let client: QueryClient;

beforeEach(() => {
  server = installFakeFetch();
  client = createQueryClient();
  client.setQueryDefaults(classKeys.all, { retryDelay: 0 });
  client.setQueryDefaults(studentKeys.all, { retryDelay: 0 });
  client.setQueryData(authKeys.me(), me());
});

afterEach(() => {
  cleanup();
  client.clear();
  server.restore();
});

const grouped = classDetail({
  students: [student({ groupId: 'g1' }), student({ id: 's2', name: 'Amy', cnName: null })],
  groups: [{ id: 'g1', name: '海豚组', emoji: '🐬', orderIndex: 0, memberIds: ['s1'] }],
  studentCount: 2,
  groupCount: 1,
});

async function openClass(detail = classDetail(), tab = '') {
  server.on('GET', '/api/classes/c1', detail);
  renderApp(client, `/classes/c1${tab}`);
  await screen.findByRole('heading', { name: detail.name });
}

describe('B08 renaming a student', () => {
  it('cached class, profile, session and billing views all refresh; the Chinese name is sent as edited', async () => {
    client.setQueryData(studentKeys.profile('s1'), profile());
    client.setQueryData(sessionKeys.detail('x1'), sessionDetail());
    client.setQueryData(billingKeys.detail('b1'), batchDetail());
    await openClass();
    expect(screen.getByText('Tom')).toBeTruthy();

    server.on('PUT', '/api/students/s1', { ...student({ name: 'Tommy' }) });
    server.on('GET', '/api/classes/c1', classDetail({ students: [student({ name: 'Tommy' })] }));
    fireEvent.click(screen.getByTitle('编辑学生姓名'));
    fireEvent.change(screen.getByDisplayValue('Tom'), { target: { value: 'Tommy' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('学生信息已更新');
    await screen.findByText('Tommy');

    expect(server.last('PUT', '/api/students/s1')!.body).toEqual({ name: 'Tommy', cnName: '汤姆' });
    expect(client.getQueryState(studentKeys.profile('s1'))!.isInvalidated).toBe(true);
    expect(client.getQueryState(sessionKeys.detail('x1'))!.isInvalidated).toBe(true);
    expect(client.getQueryState(billingKeys.detail('b1'))!.isInvalidated).toBe(true);

    server.on('GET', '/api/students/s1/profile', profile({ student: { ...profile().student, name: 'Tommy' } }));
    fireEvent.click(screen.getByTitle('查看成长档案'));
    await screen.findByRole('heading', { name: 'Tommy' });
  });

  it('renaming from the profile page refreshes the profile itself (no reload callback needed)', async () => {
    server.on('GET', '/api/students/s1/profile', profile());
    renderApp(client, '/classes/c1/students/s1');
    await screen.findByRole('heading', { name: 'Tom' });

    server.on('PUT', '/api/students/s1', student({ name: 'Tommy', cnName: null }));
    server.on(
      'GET',
      '/api/students/s1/profile',
      profile({ student: { ...profile().student, name: 'Tommy', cnName: null } }),
    );
    fireEvent.click(screen.getByTitle('编辑学生'));
    fireEvent.change(screen.getByDisplayValue('Tom'), { target: { value: 'Tommy' } });
    fireEvent.change(screen.getByDisplayValue('汤姆'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByRole('heading', { name: 'Tommy' });
    expect(server.last('PUT', '/api/students/s1')!.body).toEqual({ name: 'Tommy', cnName: null });
  });
});

describe('B09 drafts survive background refreshes (class)', () => {
  it('class notes being edited are not reset by a refetch', async () => {
    await openClass(classDetail({ notes: '# 旧资源' }), '?tab=notes');
    fireEvent.click(screen.getAllByRole('button', { name: '✎ 编辑' }).at(-1)!);
    const area = screen.getByDisplayValue('# 旧资源') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: '# 我正在写' } });

    server.on('GET', '/api/classes/c1', classDetail({ notes: '# 别处改的' }));
    await act(() => client.invalidateQueries({ queryKey: classKeys.detail('c1') }));
    await act(async () => {});
    expect(area.value).toBe('# 我正在写');

    server.on('PUT', '/api/classes/c1/notes', classDetail({ notes: '# 我正在写' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('班级资源已保存');
    expect(server.last('PUT', '/api/classes/c1/notes')!.body).toEqual({ notes: '# 我正在写' });
  });

  it('the homework template being edited is not reset by a refetch', async () => {
    await openClass(classDetail({ homeworkTemplate: '- 旧模板' }), '?tab=homework');
    fireEvent.click(screen.getAllByRole('button', { name: '✎ 编辑' }).at(-1)!);
    const area = screen.getByDisplayValue('- 旧模板') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: '- 新模板' } });
    server.on('GET', '/api/classes/c1', classDetail({ homeworkTemplate: '- 别处改的' }));
    await act(() => client.invalidateQueries({ queryKey: classKeys.detail('c1') }));
    await act(async () => {});
    expect(area.value).toBe('- 新模板');

    server.on('PUT', '/api/classes/c1/homework-template', classDetail({ homeworkTemplate: '- 新模板' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('作业模板已保存');
  });

  it('a group name being typed and a pending grouping save are not reset by a refetch', async () => {
    await openClass(grouped, '?tab=groups');
    const name = screen.getByDisplayValue('海豚组') as HTMLInputElement;
    fireEvent.change(name, { target: { value: '海豚组（改）' } });

    server.on('GET', '/api/classes/c1', { ...grouped, groups: [{ ...grouped.groups[0], name: '别处改的' }] });
    await act(() => client.invalidateQueries({ queryKey: classKeys.detail('c1') }));
    await act(async () => {});
    expect(name.value).toBe('海豚组（改）');

    const slow = deferred<Response>();
    server.on('PUT', '/api/classes/c1/groups', () => slow.promise);
    fireEvent.blur(name);
    await waitFor(() => expect(server.count('PUT', '/api/classes/c1/groups')).toBe(1));
    expect((server.last('PUT', '/api/classes/c1/groups')!.body as { groups: { name: string }[] }).groups[0].name).toBe(
      '海豚组（改）',
    );
    await act(() => client.invalidateQueries({ queryKey: classKeys.detail('c1') }));
    await act(async () => {});
    expect(name.value).toBe('海豚组（改）');

    slow.resolve(json({ ...grouped, groups: [{ ...grouped.groups[0], name: '海豚组（改）' }] }));
    await waitFor(() =>
      expect(client.getQueryData<typeof grouped>(classKeys.detail('c1'))!.groups[0].name).toBe('海豚组（改）'),
    );
    expect((screen.getByDisplayValue('海豚组（改）') as HTMLInputElement).value).toBe('海豚组（改）');
  });

  it('a failed grouping save reverts to the server grouping', async () => {
    await openClass(grouped, '?tab=groups');
    fireEvent.click(screen.getByTitle('删除小组'));
    server.on('PUT', '/api/classes/c1/groups', () => json({ error: '服务器错误' }, 500));
    await screen.findByText('分组保存失败，已恢复');
    expect(screen.getByDisplayValue('海豚组')).toBeTruthy();
  });
});

describe('students: status and deletion', () => {
  it('suspending refreshes the roster and grouping from the server', async () => {
    await openClass(grouped);
    server.on('PUT', '/api/students/s1/status', student({ status: 'suspended' }));
    server.on('GET', '/api/classes/c1', {
      ...grouped,
      students: [student({ status: 'suspended' }), grouped.students[1]],
      groups: [{ ...grouped.groups[0], memberIds: [] }],
    });
    fireEvent.click(screen.getAllByRole('button', { name: '⋯' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '停课' }));
    await screen.findByText('「Tom」已停课，并移出默认分组');
    await screen.findByText('停课');
    expect(server.last('PUT', '/api/students/s1/status')!.body).toEqual({ status: 'suspended' });
  });

  it('B17 deleting a student drops the cached profile; the roster refreshes', async () => {
    client.setQueryData(studentKeys.profile('s1'), profile());
    await openClass();
    server.on('DELETE', '/api/students/s1', { ok: true });
    server.on('GET', '/api/classes/c1', classDetail({ students: [], studentCount: 0 }));
    fireEvent.click(screen.getByRole('button', { name: '⋯' }));
    fireEvent.click(screen.getByRole('button', { name: '删除学生' }));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await screen.findByText('已删除「Tom」');
    expect(client.getQueryState(studentKeys.profile('s1'))).toBeUndefined();
    await waitFor(() => expect(screen.queryByText('Tom')).toBeNull());
  });

  it('adding a student refreshes the roster', async () => {
    await openClass();
    server.on('POST', '/api/classes/c1/students', { ...student({ id: 's3', name: 'Lucy', cnName: null }), score: 0 });
    server.on('GET', '/api/classes/c1', classDetail({ students: [student(), student({ id: 's3', name: 'Lucy' })] }));
    fireEvent.click(screen.getByRole('button', { name: /手动添加学生/ }));
    fireEvent.change(screen.getByPlaceholderText('如 Lucy'), { target: { value: 'Lucy' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    await screen.findByText('已添加「Lucy」');
    await screen.findByText('Lucy');
  });
});

describe('class list and class info', () => {
  it('creating a class lands on its detail without a cold read', async () => {
    server.on('GET', '/api/classes', [classListItem()]);
    server.on('GET', '/api/teachers', [teacher()]);
    server.on('POST', '/api/classes', classDetail({ id: 'c9', name: '新班' }));
    renderApp(client, '/');
    await screen.findByText('三年级A班');
    fireEvent.click(screen.getByRole('button', { name: /新建班级/ }));
    fireEvent.change(screen.getByPlaceholderText('如 三年级A班'), { target: { value: '新班' } });
    fireEvent.click(screen.getByRole('button', { name: '创建班级' }));
    await screen.findByRole('heading', { name: '新班' });
    expect(server.count('GET', '/api/classes/c9')).toBe(0);
  });

  it('the class list keeps its archived split as a client-side view of one shared query', async () => {
    server.on('GET', '/api/classes', [classListItem(), classListItem({ id: 'c2', name: '旧班', isArchived: true })]);
    renderApp(client, '/');
    await screen.findByText('三年级A班');
    expect(screen.queryByText('旧班')).toBeNull();
    fireEvent.click(screen.getByText('1 个归档 ›'));
    await screen.findByText('旧班');
    expect(server.count('GET', '/api/classes')).toBe(1);
  });

  it('B19 the class info modal reuses the fresh teacher list; reopening does not re-request', async () => {
    client.setQueryData(teacherKeys.lists(), [teacher(), teacher({ id: 't2', name: '李老师' })]);
    await openClass();
    fireEvent.click(screen.getAllByRole('button', { name: '✎ 编辑' })[0]);
    expect(screen.getByRole('option', { name: '李老师' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getAllByRole('button', { name: '✎ 编辑' })[0]);
    expect(screen.getByRole('option', { name: '李老师' })).toBeTruthy();
    expect(server.count('GET', '/api/teachers')).toBe(0);
  });

  it('editing class info writes the detail and keeps the page', async () => {
    server.on('GET', '/api/teachers', [teacher()]);
    await openClass();
    server.on('PUT', '/api/classes/c1', classDetail({ name: '三年级A班（改）' }));
    fireEvent.click(screen.getAllByRole('button', { name: '✎ 编辑' })[0]);
    fireEvent.change(screen.getByPlaceholderText('如 三年级A班'), { target: { value: '三年级A班（改）' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByRole('heading', { name: '三年级A班（改）' });
    await screen.findByText('班级信息已更新');
    expect(server.count('GET', '/api/classes/c1')).toBe(1);
  });

  it('a missing class says so instead of a blank page', async () => {
    server.on('GET', '/api/classes/c404', () => json({ error: 'class not found' }, 404));
    renderApp(client, '/classes/c404');
    await screen.findByText('班级不存在或已被删除');
  });

  it('the invite tab reads the join-request queue', async () => {
    server.on('GET', '/api/classes/c1/join-requests', [
      { id: 'j1', cnName: '小明', enName: null, parentPhone: null, photoUrl: null, nickname: '明妈', createdAt: '' },
    ]);
    await openClass(classDetail(), '?tab=invite');
    await screen.findByText('小明');
    expect(screen.getByText('邀请队列（1）')).toBeTruthy();
  });
});

describe('profile and teachers', () => {
  it('a missing student profile says it does not exist', async () => {
    server.on('GET', '/api/students/sx/profile', () => json({ error: 'student not found' }, 404));
    renderApp(client, '/classes/c1/students/sx');
    await screen.findByText('学生不存在或已被删除');
  });

  it('renaming yourself updates the teacher list and the top bar', async () => {
    server.on('GET', '/api/teachers', [teacher(), teacher({ id: 't2', name: '李老师' })]);
    renderApp(client, '/teachers');
    await screen.findByText('李老师');
    server.on('PUT', '/api/teachers/t1', teacher({ name: '王丽丽' }));
    server.on('GET', '/api/teachers', [teacher({ name: '王丽丽' }), teacher({ id: 't2', name: '李老师' })]);
    server.on('GET', '/api/me', me({ name: '王丽丽' }));
    fireEvent.click(screen.getAllByTitle('编辑老师')[0]);
    fireEvent.change(screen.getByPlaceholderText('如 李芳'), { target: { value: '王丽丽' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('已保存「王丽丽」');
    await screen.findByRole('button', { name: /王丽丽/ });
    expect(screen.getAllByText('王丽丽').length).toBeGreaterThan(1);
  });
});

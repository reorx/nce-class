// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient, STALE_TIME } from '../queries/client';
import { authKeys, billingKeys, classKeys, scheduleKeys } from '../queries/keys';
import { renderApp } from '../test-utils/app';
import { deferred, installFakeFetch, json, type FakeServer } from '../test-utils/fakeFetch';
import {
  batchDetail,
  batchItem,
  classDetail,
  classListItem,
  invoice,
  invoiceLessons,
  me,
  scheduleDetail,
  scheduleItem,
} from '../test-utils/fixtures';

// 批次 B：收银台（列表 / 详情 / 费用编辑 / 创建与重置弹窗）与排班 tab。编号对应 Plan 2「先写的行为测试」。

let server: FakeServer;
let client: QueryClient;

beforeEach(() => {
  server = installFakeFetch();
  client = createQueryClient();
  client.setQueryDefaults(billingKeys.all, { retryDelay: 0 });
  client.setQueryDefaults(classKeys.all, { retryDelay: 0 });
  client.setQueryDefaults(scheduleKeys.all, { retryDelay: 0 });
  client.setQueryData(authKeys.me(), me());
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  server.restore();
});

const CARD = '三年级A班 · 秋季';
const paid = invoice({ status: 'paid', paidAt: '2026-10-07 10:00:00', paidByName: '王丽' });
const paidTotals = { paidCount: 1, paidAmountCents: 15000, pendingAmountCents: 0 };

function serveBilling() {
  server.on('GET', '/api/billing/batches', [batchItem()]);
  server.on('GET', '/api/billing/batches/b1', batchDetail());
  server.on('GET', '/api/invoices/i1/lessons', invoiceLessons());
}

/** 卡片标题与详情页 h1 文案相同；列表里用卡片链接定位。 */
const card = (name = CARD) => screen.getByText(name, { selector: 'strong' });
const back = () => fireEvent.click(screen.getByText('返回收银台'));

async function openDetailFromList() {
  fireEvent.click(await screen.findByText(CARD, { selector: 'strong' }));
  await screen.findByRole('heading', { name: CARD });
}

describe('B01 list ↔ detail round trip within staleTime', () => {
  it('the list paints from cache on the first frame after returning; no extra list GET', async () => {
    serveBilling();
    renderApp(client, '/billing');
    await openDetailFromList();

    back();
    expect(card()).toBeTruthy();
    expect(screen.queryByText('加载中…')).toBeNull();
    await act(async () => {});
    expect(server.count('GET', '/api/billing/batches')).toBe(1);
  });

  it('hovering a card prefetches the full detail, so opening it needs no second request', async () => {
    serveBilling();
    renderApp(client, '/billing');
    const link = (await screen.findByText(CARD, { selector: 'strong' })).closest('a')!;
    fireEvent.pointerEnter(link);
    await waitFor(() => expect(client.getQueryData(billingKeys.detail('b1'))).toBeDefined());

    fireEvent.click(link);
    expect(screen.getByRole('heading', { name: CARD })).toBeTruthy();
    expect(screen.getByRole('button', { name: '确认收款' })).toBeTruthy();
    expect(server.count('GET', '/api/billing/batches/b1')).toBe(1);
  });
});

describe('B02 stale but not collected', () => {
  it('keeps the old rows while a slow refresh runs, then swaps them; never shows the empty state', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    serveBilling();
    renderApp(client, '/billing');
    await openDetailFromList();

    vi.setSystemTime(new Date(Date.now() + STALE_TIME + 1));
    const slow = deferred<Response>();
    server.on('GET', '/api/billing/batches', () => slow.promise);
    back();
    expect(card()).toBeTruthy();
    await waitFor(() => expect(server.count('GET', '/api/billing/batches')).toBe(2));
    expect(screen.getByText('刷新中…')).toBeTruthy();
    expect(screen.queryByText(/还没有收款项/)).toBeNull();

    slow.resolve(json([batchItem({ scheduleName: '冬季' })]));
    await screen.findByText('三年级A班 · 冬季', { selector: 'strong' });
    expect(screen.queryByText(CARD, { selector: 'strong' })).toBeNull();
  });
});

describe('B03 first-load outcomes', () => {
  it('an empty list shows the business empty state', async () => {
    server.on('GET', '/api/billing/batches', []);
    renderApp(client, '/billing');
    await screen.findByText(/还没有收款项/);
  });

  it('a 500 (after its one retry) shows a retryable error, not a forever spinner', async () => {
    server.on('GET', '/api/billing/batches', () => json({ error: '服务器错误' }, 500));
    renderApp(client, '/billing');
    await screen.findByText('收款项加载失败');
    expect(server.count('GET', '/api/billing/batches')).toBe(2);

    server.on('GET', '/api/billing/batches', [batchItem()]);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await screen.findByText(CARD, { selector: 'strong' });
  });

  it('a 404 detail says it does not exist (no retry offered)', async () => {
    server.on('GET', '/api/billing/batches/gone', () => json({ error: 'batch not found' }, 404));
    renderApp(client, '/billing/gone');
    await screen.findByText('收款项不存在或已被删除');
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
  });
});

describe('B04 / B05 confirming a payment', () => {
  it('B04 detail confirm → back to list: totals end up matching the server; one confirm request', async () => {
    serveBilling();
    renderApp(client, '/billing');
    await openDetailFromList();

    server.on('POST', '/api/invoices/i1/confirm', paid);
    server.on('GET', '/api/billing/batches/b1', batchDetail({ ...paidTotals, invoices: [paid] }));
    server.on('GET', '/api/billing/batches', [batchItem(paidTotals)]);
    fireEvent.click(screen.getByRole('button', { name: '确认收款' }));
    await screen.findByText(/已确认收款：Tom/);
    expect(screen.getByText('✓ 已收款')).toBeTruthy();

    back();
    await screen.findByText('✓ 已收齐');
    expect(server.count('POST', '/api/invoices/i1/confirm')).toBe(1);
  });

  it('B05 the write succeeds but the follow-up detail read fails: success + refresh failure, content kept, no resubmit', async () => {
    serveBilling();
    renderApp(client, '/billing/b1');
    await screen.findByRole('heading', { name: CARD });

    server.on('POST', '/api/invoices/i1/confirm', paid);
    server.on('GET', '/api/billing/batches/b1', () => json({ error: '服务器错误' }, 500));
    fireEvent.click(screen.getByRole('button', { name: '确认收款' }));
    await screen.findByText(/已确认收款：Tom/);
    await screen.findByText(/刷新失败：服务器错误/);
    expect(screen.getByRole('heading', { name: CARD })).toBeTruthy();
    expect(screen.getByText('✓ 已收款')).toBeTruthy();
    expect(screen.queryByText(/操作失败/)).toBeNull();
    expect(server.count('POST', '/api/invoices/i1/confirm')).toBe(1);
  });

  it('a row with a pending confirm cannot be confirmed twice', async () => {
    serveBilling();
    renderApp(client, '/billing/b1');
    await screen.findByRole('heading', { name: CARD });
    const slow = deferred<Response>();
    server.on('POST', '/api/invoices/i1/confirm', () => slow.promise);
    fireEvent.click(screen.getByRole('button', { name: '确认收款' }));
    const pendingBtn = await screen.findByRole('button', { name: '确认中…' });
    fireEvent.click(pendingBtn);
    expect(server.count('POST', '/api/invoices/i1/confirm')).toBe(1);
    slow.resolve(json(paid));
    await screen.findByText(/已确认收款/);
  });
});

describe('B06 create returns the full detail', () => {
  it('creating a batch lands on its detail with no cold read (the response is the detail)', async () => {
    server.on('GET', '/api/billing/batches', []);
    server.on('GET', '/api/classes', [classListItem()]);
    server.on('GET', '/api/classes/c1/schedules', [scheduleItem()]);
    const created = batchDetail({ invoices: [invoice(), invoice({ id: 'i2', studentId: 's2', studentName: 'Amy' })] });
    server.on('POST', '/api/billing/batches', created);
    renderApp(client, '/billing');
    await screen.findByText(/还没有收款项/);

    fireEvent.click(screen.getByRole('button', { name: /创建收款项/ }));
    fireEvent.click(await screen.findByRole('button', { name: /秋季/ }));
    fireEvent.change(screen.getByPlaceholderText('120'), { target: { value: '150' } });
    server.on('GET', '/api/billing/batches', [batchItem()]);
    fireEvent.click(screen.getByRole('button', { name: '生成收款项' }));

    await screen.findByRole('heading', { name: CARD });
    expect(screen.getByText('Amy')).toBeTruthy();
    expect(server.count('GET', '/api/billing/batches/b1')).toBe(0);
    expect(server.last('POST', '/api/billing/batches')!.body).toMatchObject({
      scheduleId: 'p1',
      unitPriceCents: 15000,
    });
  });
});

describe('B07 create modal: class switching and archived classes', () => {
  async function openCreate() {
    server.on('GET', '/api/billing/batches', []);
    renderApp(client, '/billing');
    await screen.findByText(/还没有收款项/);
    fireEvent.click(screen.getByRole('button', { name: /创建收款项/ }));
    const select = await screen.findByLabelText('选择班级');
    await waitFor(() => expect((select as HTMLSelectElement).disabled).toBe(false));
    return select as HTMLSelectElement;
  }

  it('A then B quickly: A’s late schedules never replace B’s, and A’s request is aborted', async () => {
    server.on('GET', '/api/classes', [classListItem(), classListItem({ id: 'c2', name: '四年级B班' })]);
    const slowA = deferred<Response>();
    server.on('GET', '/api/classes/c1/schedules', () => slowA.promise);
    server.on('GET', '/api/classes/c2/schedules', [scheduleItem({ id: 'p2', name: 'B 的周期' })]);
    const select = await openCreate();
    await waitFor(() => expect(server.count('GET', '/api/classes/c1/schedules')).toBe(1));

    fireEvent.change(select, { target: { value: 'c2' } });
    await screen.findByRole('button', { name: /B 的周期/ });
    expect(server.last('GET', '/api/classes/c1/schedules')!.signal!.aborted).toBe(true);

    slowA.resolve(json([scheduleItem({ name: 'A 的周期' })]));
    await act(async () => {});
    expect(screen.queryByText('A 的周期')).toBeNull();
    expect(select.value).toBe('c2');
  });

  it('archived classes are not offered; reopening after the chosen class got archived falls back to the first one', async () => {
    server.on('GET', '/api/classes', [
      classListItem(),
      classListItem({ id: 'c2', name: '四年级B班' }),
      classListItem({ id: 'c3', name: '归档班', isArchived: true }),
    ]);
    server.on('GET', '/api/classes/c1/schedules', [scheduleItem()]);
    server.on('GET', '/api/classes/c2/schedules', [scheduleItem({ id: 'p2', name: 'B 的周期' })]);
    const select = await openCreate();
    expect([...select.options].map((o) => o.textContent)).toEqual(['三年级A班（1 人）', '四年级B班（1 人）']);

    fireEvent.change(select, { target: { value: 'c2' } });
    await screen.findByRole('button', { name: /B 的周期/ });
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    client.setQueryData(classKeys.lists(), [classListItem(), classListItem({ id: 'c2', isArchived: true })]);
    fireEvent.click(screen.getByRole('button', { name: /创建收款项/ }));
    const reopened = (await screen.findByLabelText('选择班级')) as HTMLSelectElement;
    expect(reopened.value).toBe('c1');
    await screen.findByRole('button', { name: /秋季/ });
  });

  it('B19 reopening the modal while the class list is fresh does not re-request it', async () => {
    server.on('GET', '/api/classes', [classListItem()]);
    server.on('GET', '/api/classes/c1/schedules', [scheduleItem()]);
    await openCreate();
    await screen.findByRole('button', { name: /秋季/ });
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(screen.getByRole('button', { name: /创建收款项/ }));
    await screen.findByRole('button', { name: /秋季/ });
    expect(server.count('GET', '/api/classes')).toBe(1);
    expect(server.count('GET', '/api/classes/c1/schedules')).toBe(1);
  });
});

describe('B09 drafts survive background refreshes (billing)', () => {
  it('reset-terms draft and the invoice amount draft are not overwritten by a refetch', async () => {
    serveBilling();
    renderApp(client, '/billing/b1');
    await screen.findByRole('heading', { name: CARD });
    server.on('GET', '/api/billing/batches/b1', batchDetail({ unitPriceCents: 18000 }));

    fireEvent.click(screen.getByRole('button', { name: '↻ 重置收款项' }));
    const price = screen.getByPlaceholderText('120') as HTMLInputElement;
    expect(price.value).toBe('150');
    fireEvent.change(price, { target: { value: '199' } });
    await act(() => client.invalidateQueries({ queryKey: billingKeys.detail('b1') }));
    await waitFor(() => expect(screen.getByText(/单价 ¥180\/节/)).toBeTruthy());
    expect(price.value).toBe('199');
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    const amount = screen.getByDisplayValue('150') as HTMLInputElement;
    fireEvent.change(amount, { target: { value: '100' } });
    server.on('GET', '/api/billing/batches/b1', batchDetail({ invoices: [invoice({ note: '别处改的' })] }));
    await act(() => client.invalidateQueries({ queryKey: billingKeys.all }));
    await act(async () => {});
    expect(amount.value).toBe('100');
  });

  it('the invoice lessons in the edit modal show their own loading and error states', async () => {
    serveBilling();
    server.on('GET', '/api/invoices/i1/lessons', () => json({ error: '服务器错误' }, 500));
    renderApp(client, '/billing/b1');
    await screen.findByRole('heading', { name: CARD });
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await screen.findByText('出勤明细加载失败');
    server.on('GET', '/api/invoices/i1/lessons', invoiceLessons());
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await screen.findByText('✓ 到堂');
  });

  it('saving the invoice amount closes the modal and shows the new amount', async () => {
    serveBilling();
    renderApp(client, '/billing/b1');
    await screen.findByRole('heading', { name: CARD });
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByDisplayValue('150'), { target: { value: '120' } });
    const edited = invoice({ finalAmountCents: 12000, adjusted: 1 });
    server.on('PUT', '/api/invoices/i1', edited);
    server.on('GET', '/api/billing/batches/b1', batchDetail({ invoices: [edited] }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText(/已保存 Tom 的费用/);
    expect(screen.queryByText(/编辑费用/)).toBeNull();
    expect(screen.getByText('¥120')).toBeTruthy();
    expect(server.last('PUT', '/api/invoices/i1')!.body).toEqual({ finalAmountCents: 12000, note: '' });
  });
});

describe('B17 deleting a batch', () => {
  it('lands on the list without the deleted batch; its detail cache is gone and is not re-read', async () => {
    server.on('GET', '/api/billing/batches', [batchItem(), batchItem({ id: 'b2', scheduleName: '冬季' })]);
    server.on('GET', '/api/billing/batches/b1', batchDetail());
    renderApp(client, '/billing');
    await openDetailFromList();

    server.on('DELETE', '/api/billing/batches/b1', { ok: true });
    server.on('GET', '/api/billing/batches', [batchItem({ id: 'b2', scheduleName: '冬季' })]);
    fireEvent.click(screen.getByRole('button', { name: '删除收款项' }));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    await screen.findByText('三年级A班 · 冬季', { selector: 'strong' });
    expect(screen.queryByText(CARD, { selector: 'strong' })).toBeNull();
    expect(client.getQueryState(billingKeys.detail('b1'))).toBeUndefined();
    await act(async () => {});
    expect(server.count('GET', '/api/billing/batches/b1')).toBe(1);
  });
});

describe('schedule tab (B09 / B18)', () => {
  function serveClass() {
    server.on('GET', '/api/classes/c1', classDetail());
    server.on('GET', '/api/classes/c1/schedules', [scheduleItem({ batchId: 'b1' })]);
  }

  /** 班级页头部也有「✎ 编辑」（班级信息），排班列表的在它之后。 */
  async function editFirstSchedule() {
    await screen.findByText('已生成收款批次 →');
    fireEvent.click(screen.getAllByRole('button', { name: '✎ 编辑' }).at(-1)!);
  }

  it('editing waits for the detail, initialises once, and a refetch does not reset the editor', async () => {
    serveClass();
    const slow = deferred<Response>();
    server.on('GET', '/api/schedules/p1', () => slow.promise);
    renderApp(client, '/classes/c1?tab=schedule');
    await editFirstSchedule();
    await screen.findByText('加载中…');

    slow.resolve(json(scheduleDetail({ name: '秋季' })));
    const name = (await screen.findByDisplayValue('秋季')) as HTMLInputElement;
    fireEvent.change(name, { target: { value: '秋季（改）' } });
    server.on('GET', '/api/schedules/p1', scheduleDetail({ name: '别处改的名字' }));
    await act(() => client.invalidateQueries({ queryKey: scheduleKeys.detail('p1') }));
    await act(async () => {});
    expect(name.value).toBe('秋季（改）');
  });

  it('B18 saving a schedule refreshes billing views but never asks for a recalculation', async () => {
    serveClass();
    server.on('GET', '/api/schedules/p1', scheduleDetail({ batchId: 'b1' }));
    client.setQueryData(billingKeys.detail('b1'), batchDetail());
    const snapshot = client.getQueryData(billingKeys.detail('b1'));
    renderApp(client, '/classes/c1?tab=schedule');
    await editFirstSchedule();
    fireEvent.change(await screen.findByDisplayValue('秋季'), { target: { value: '秋季（改）' } });

    server.on('PUT', '/api/schedules/p1', scheduleDetail({ name: '秋季（改）', batchId: 'b1' }));
    server.on('GET', '/api/classes/c1/schedules', [scheduleItem({ name: '秋季（改）', batchId: 'b1' })]);
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await screen.findByText('课程周期已保存');
    await screen.findByText('秋季（改）');

    expect(client.getQueryState(billingKeys.detail('b1'))!.isInvalidated).toBe(true);
    expect(client.getQueryData(billingKeys.detail('b1'))).toBe(snapshot);
    expect(server.calls.filter((c) => c.url.includes('/recalculate'))).toHaveLength(0);
  });

  it('archived class: creating is disabled, existing periods stay editable', async () => {
    server.on('GET', '/api/classes/c1', classDetail({ isArchived: true }));
    server.on('GET', '/api/classes/c1/schedules', [scheduleItem()]);
    renderApp(client, '/classes/c1?tab=schedule');
    const create = await screen.findByRole('button', { name: /新建课程周期/ });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    await screen.findByText('未生成收款批次');
    expect((screen.getAllByRole('button', { name: '✎ 编辑' }).at(-1) as HTMLButtonElement).disabled).toBe(false);
  });
});

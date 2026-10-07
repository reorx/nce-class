import { get, request, type RequestOptions } from './client';
import type { StudentStatus } from './students';

// ---- 收费 (收款批次/收款单) ----
// 应收 = 单价 × 课程次数 + 附加费，全班一致、不按到堂扣减；金额一律整数分。

export interface BillingBatchItem {
  id: string;
  classId: string;
  className: string;
  scheduleId: string;
  scheduleName: string;
  lessonCount: number; // 计费课程次数 = override ?? 排班节数
  scheduleLessonCount: number; // 排班表本身的节数
  lessonCountOverride: number | null; // 用户覆盖的课程次数；null = 跟随排班
  minDate: string | null;
  maxDate: string | null;
  heldSessionCount: number; // 周期范围内实际已上节数（live）
  futureLessonCount: number; // 未上的计划节数（live）
  unitPriceCents: number;
  addonCents: number;
  addonNote: string | null;
  snapshotAt: string | null;
  createdAt: string;
  invoiceCount: number;
  paidCount: number;
  paidAmountCents: number;
  pendingAmountCents: number;
  totalAmountCents: number;
}

export interface InvoiceItem {
  id: string;
  studentId: string;
  studentName: string;
  studentCnName: string | null;
  studentStatus: StudentStatus;
  attendedCount: number; // 已上到堂（快照），仅展示
  plannedCount: number;
  billableCount: number; // 计费节数 = 批次课程次数，人人相同
  unitPriceCents: number;
  computedAmountCents: number; // 应收 = 单价 × 计费节数 + 附加费
  finalAmountCents: number;
  adjusted: number; // 1 = final 被手动覆盖过（重算保留 final/note）
  note: string | null;
  status: 'pending' | 'paid';
  paidAt: string | null;
  paidByName: string | null;
}

export interface BillingBatchDetail extends BillingBatchItem {
  invoices: InvoiceItem[];
}

/** 编辑弹窗逐节明细行：实际课堂 / 未上排班 / 过去未开课的排班日。只看出勤，不决定应收。 */
export interface InvoiceLessonRow {
  kind: 'session' | 'planned' | 'missed';
  date: string;
  startTime: string | null;
  endTime?: string;
  sessionId?: string;
  lessonNumber?: number | null;
  lessonTitle?: string | null;
  attendance?: 'present' | 'absent' | 'leave' | null; // null = 该节无快照行（未入班）
  madeUp?: boolean;
  inSchedule?: boolean; // false = 排班外临时加课
}

export interface InvoiceLessons {
  invoiceId: string;
  studentId: string;
  rows: InvoiceLessonRow[];
}

export interface CreateBillingBatchInput {
  scheduleId: string;
  unitPriceCents: number;
  addonCents?: number;
  addonNote?: string;
  lessonCount?: number;
}

export interface BillingTermsInput {
  unitPriceCents?: number;
  addonCents?: number;
  addonNote?: string;
  lessonCount?: number;
}

export interface UpdateInvoiceInput {
  finalAmountCents?: number;
  note?: string;
}

export const listBillingBatches = (options?: RequestOptions) =>
  get<BillingBatchItem[]>('/api/billing/batches', options);

export const getBillingBatch = (id: string, options?: RequestOptions) =>
  get<BillingBatchDetail>(`/api/billing/batches/${id}`, options);

// 新建/重算返回完整 BillingBatchDetail（与 GET 同形）。归档班级新建 → 409。
export const createBillingBatch = (input: CreateBillingBatchInput) =>
  request<BillingBatchDetail>('POST', '/api/billing/batches', input);

/** 无 body = 按当前条款刷新待收款行；带 body = 重置条款（单价/附加费/课程次数随批次更新）。 */
export const recalculateBillingBatch = (id: string, terms?: BillingTermsInput) =>
  request<BillingBatchDetail>('POST', `/api/billing/batches/${id}/recalculate`, terms);

export const deleteBillingBatch = (id: string) => request<{ ok: true }>('DELETE', `/api/billing/batches/${id}`);

/** 已确认收款 → 409。响应只是这一行，批次汇总需重新读取。 */
export const updateInvoice = (id: string, input: UpdateInvoiceInput) =>
  request<InvoiceItem>('PUT', `/api/invoices/${id}`, input);

export const confirmInvoice = (id: string) => request<InvoiceItem>('POST', `/api/invoices/${id}/confirm`);

export const unconfirmInvoice = (id: string) => request<InvoiceItem>('POST', `/api/invoices/${id}/unconfirm`);

export const getInvoiceLessons = (id: string, options?: RequestOptions) =>
  get<InvoiceLessons>(`/api/invoices/${id}/lessons`, options);

import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import {
  confirmInvoice,
  createBillingBatch,
  deleteBillingBatch,
  getBillingBatch,
  getInvoiceLessons,
  listBillingBatches,
  recalculateBillingBatch,
  unconfirmInvoice,
  updateInvoice,
  type BillingTermsInput,
  type CreateBillingBatchInput,
  type UpdateInvoiceInput,
} from '../api/billing';
import { billingBatchCreated, billingBatchDeleted, billingBatchRecalculated, invoiceChanged } from './cache-effects';
import { enabledWith, type QueryHookOptions } from './client';
import { billingKeys } from './keys';
import { useAppMutation } from './mutation';

// 收费采用成功后更新，不乐观显示已到账。all / pending / settled 是客户端筛选，不进 key。

export const billingBatchesQueryOptions = () =>
  queryOptions({
    queryKey: billingKeys.lists(),
    queryFn: ({ signal }) => listBillingBatches({ signal }),
  });

export const useBillingBatchesQuery = (options?: QueryHookOptions) =>
  useQuery({ ...billingBatchesQueryOptions(), enabled: options?.enabled });

export const billingBatchQueryOptions = (batchId: string) =>
  queryOptions({
    queryKey: billingKeys.detail(batchId),
    queryFn: ({ signal }) => getBillingBatch(batchId, { signal }),
  });

export const useBillingBatchQuery = (batchId: string | undefined, options?: QueryHookOptions) =>
  useQuery({ ...billingBatchQueryOptions(batchId ?? ''), enabled: enabledWith(batchId, options) });

/** 列表卡片 hover / focus 时预取完整详情；fresh 时不重复请求。 */
export function usePrefetchBillingBatch() {
  const client = useQueryClient();
  return useCallback((batchId: string) => client.prefetchQuery(billingBatchQueryOptions(batchId)), [client]);
}

export const invoiceLessonsQueryOptions = (invoiceId: string) =>
  queryOptions({
    queryKey: billingKeys.invoiceLessons(invoiceId),
    queryFn: ({ signal }) => getInvoiceLessons(invoiceId, { signal }),
  });

/** 费用编辑弹窗打开时才传 invoiceId。 */
export const useInvoiceLessonsQuery = (invoiceId: string | undefined, options?: QueryHookOptions) =>
  useQuery({ ...invoiceLessonsQueryOptions(invoiceId ?? ''), enabled: enabledWith(invoiceId, options) });

export function useCreateBillingBatchMutation() {
  return useAppMutation({
    mutationFn: (input: CreateBillingBatchInput) => createBillingBatch(input),
    onSuccess: (client, detail) => billingBatchCreated(client, detail),
  });
}

/** terms 缺省 = 按当前条款刷新待收款行（不发 body）；带 terms = 重置条款。 */
export function useRecalculateBillingBatchMutation() {
  return useAppMutation({
    mutationFn: ({ batchId, terms }: { batchId: string; terms?: BillingTermsInput }) =>
      recalculateBillingBatch(batchId, terms),
    onSuccess: (client, detail) => billingBatchRecalculated(client, detail),
  });
}

export function useDeleteBillingBatchMutation() {
  return useAppMutation({
    mutationFn: ({ batchId }: { batchId: string }) => deleteBillingBatch(batchId),
    onSuccess: (client, _data, { batchId }) => billingBatchDeleted(client, batchId),
  });
}

type InvoiceVariables = { invoiceId: string; batchId?: string };

export function useUpdateInvoiceMutation() {
  return useAppMutation({
    mutationFn: ({ invoiceId, input }: InvoiceVariables & { input: UpdateInvoiceInput }) =>
      updateInvoice(invoiceId, input),
    onSuccess: (client, invoice, { batchId }) => invoiceChanged(client, invoice, batchId),
  });
}

export function useConfirmInvoiceMutation() {
  return useAppMutation({
    mutationFn: ({ invoiceId }: InvoiceVariables) => confirmInvoice(invoiceId),
    onSuccess: (client, invoice, { batchId }) => invoiceChanged(client, invoice, batchId),
  });
}

export function useUnconfirmInvoiceMutation() {
  return useAppMutation({
    mutationFn: ({ invoiceId }: InvoiceVariables) => unconfirmInvoice(invoiceId),
    onSuccess: (client, invoice, { batchId }) => invoiceChanged(client, invoice, batchId),
  });
}

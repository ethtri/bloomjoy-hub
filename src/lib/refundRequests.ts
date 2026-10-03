import { z } from 'zod';
import { supabaseClient } from '@/lib/supabaseClient';

export type RefundRequestMachine = {
  machineId: string; machineLabel: string; locationId: string | null; locationName: string | null;
  timezone: string; accountId: string | null; accountName: string | null; canOpenManagerWorkspace: boolean;
};
export type RefundRequestAccess = { hasAccess: boolean; machines: RefundRequestMachine[] };
export type RefundRequest = {
  caseId: string; publicReference: string; machineId: string; machineLabel: string; locationName: string | null;
  timezone: string; accountId: string | null; accountName: string | null; receivedAt: string | null;
  incidentAt: string | null; updatedAt: string | null; issueCategory: string | null; comment: string | null; commentTruncated: boolean;
  requestedAmountCents: number | null; currencyCode: 'USD' | null; statusLabel: string;
  outcomeLabel: string | null; canOpenManagerWorkspace: boolean;
};
export type RefundRequestPeriod = { from: string; to: string; machineId: string; offset: number };
const machineSchema = z.object({
  machineId: z.string(), machineLabel: z.string(), locationId: z.string().nullable(), locationName: z.string().nullable(),
  timezone: z.string(), accountId: z.string().nullable(), accountName: z.string().nullable(), canOpenManagerWorkspace: z.boolean(),
});
const requestSchema = z.object({
  caseId: z.string(), publicReference: z.string(), machineId: z.string(), machineLabel: z.string(), locationName: z.string().nullable(),
  timezone: z.string(), accountId: z.string().nullable(), accountName: z.string().nullable(), receivedAt: z.string().nullable(),
  incidentAt: z.string().nullable(), updatedAt: z.string().nullable(), issueCategory: z.string().nullable(), comment: z.string().nullable(),
  commentTruncated: z.boolean(), requestedAmountCents: z.number().int().nonnegative().nullable(), currencyCode: z.literal('USD').nullable(),
  statusLabel: z.string(), outcomeLabel: z.string().nullable(), canOpenManagerWorkspace: z.boolean(),
});
export const refundRequestAccessKey = (userId: string | undefined) => ['refund-request-access', userId];
export async function fetchRefundRequestAccess(): Promise<RefundRequestAccess> {
  const { data, error } = await supabaseClient.rpc('get_refund_request_access');
  if (error) throw error;
  return z.object({ hasAccess: z.boolean(), machines: z.array(machineSchema) }).parse(data);
}
export async function fetchRefundRequests(period: RefundRequestPeriod): Promise<{ requests: RefundRequest[]; hasMore: boolean }> {
  const { data, error } = await supabaseClient.rpc('get_refund_requests', {
    p_date_from: period.from, p_date_to: period.to, p_machine_id: period.machineId || null, p_limit: 50, p_offset: period.offset,
  });
  if (error) throw error;
  return z.object({ requests: z.array(requestSchema), hasMore: z.boolean() }).parse(data);
}
export async function fetchRefundRequest(caseId: string): Promise<RefundRequest | null> {
  const { data, error } = await supabaseClient.rpc('get_refund_request', { p_case_id: caseId });
  if (error) throw error;
  return requestSchema.nullable().parse(data);
}
export function validRefundRequestPeriod(from: string, to: string) {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  return valid(from) && valid(to) && from <= to && (Date.parse(to) - Date.parse(from)) / 86400000 <= 366;
}

export const validRefundRequestId = (value: string | null) => Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
export const refundRequestIssueLabel = (value: string | null) => value === null ? 'Issue not recorded' : ({ charged_no_product: 'Paid, but no product', product_problem: 'Product problem', charged_more_than_once: 'Charged more than once', wrong_amount: 'Wrong amount', partial_items: 'Fewer items than paid for', expected_cash_change: 'Missing cash change', other: 'Other issue' }[value] ?? 'Reported issue');

import { supabaseClient } from '@/lib/supabaseClient';

export type OrderFulfillmentStatus =
  | 'unfulfilled'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'canceled';

export type OrderRecord = {
  id: string;
  user_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_customer_id: string | null;
  status: string;
  amount_total: number | null;
  currency: string | null;
  customer_email: string | null;
  receipt_url: string | null;
  line_items: Array<Record<string, unknown>>;
  fulfillment_status: OrderFulfillmentStatus;
  fulfillment_tracking_url: string | null;
  fulfillment_notes: string | null;
  fulfillment_assigned_to: string | null;
  fulfilled_at: string | null;
  fulfilled_by: string | null;
  created_at: string;
  updated_at: string;
};

type AdminOrderFilterInput = {
  dateFrom?: string;
  dateTo?: string;
  fulfillmentStatus?: OrderFulfillmentStatus | 'all';
};

type UpdateOrderFulfillmentInput = {
  orderId: string;
  fulfillmentStatus: OrderFulfillmentStatus;
  trackingUrl: string;
  fulfillmentNotes: string;
  assignedTo: string | null;
};

export const fetchPortalOrders = async (): Promise<OrderRecord[]> => {
  const { data, error } = await supabaseClient
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to load orders.');
  }

  return data as OrderRecord[];
};

export const fetchAdminOrders = async ({
  dateFrom,
  dateTo,
  fulfillmentStatus = 'all',
}: AdminOrderFilterInput): Promise<OrderRecord[]> => {
  let query = supabaseClient.from('orders').select('*').order('created_at', { ascending: false });

  if (dateFrom) {
    query = query.gte('created_at', `${dateFrom}T00:00:00.000Z`);
  }

  if (dateTo) {
    query = query.lte('created_at', `${dateTo}T23:59:59.999Z`);
  }

  if (fulfillmentStatus !== 'all') {
    query = query.eq('fulfillment_status', fulfillmentStatus);
  }

  const { data, error } = await query;

  if (error || !data) {
    throw new Error(error?.message || 'Unable to load admin orders.');
  }

  return data as OrderRecord[];
};

export const updateOrderFulfillmentAdmin = async ({
  orderId,
  fulfillmentStatus,
  trackingUrl,
  fulfillmentNotes,
  assignedTo,
}: UpdateOrderFulfillmentInput): Promise<OrderRecord> => {
  const { data, error } = await supabaseClient.rpc('admin_update_order_fulfillment', {
    p_order_id: orderId,
    p_fulfillment_status: fulfillmentStatus,
    p_tracking_url: trackingUrl,
    p_fulfillment_notes: fulfillmentNotes,
    p_assigned_to: assignedTo,
  });

  if (error || !data) {
    throw new Error(error?.message || 'Unable to update fulfillment.');
  }

  return data as OrderRecord;
};

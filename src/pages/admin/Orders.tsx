import { useMemo, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  fetchAdminOrders,
  type OrderFulfillmentStatus,
  type OrderRecord,
  updateOrderFulfillmentAdmin,
} from '@/lib/orders';
import { trackEvent } from '@/lib/analytics';
import { toast } from 'sonner';

const fulfillmentOptions: OrderFulfillmentStatus[] = [
  'unfulfilled',
  'processing',
  'shipped',
  'delivered',
  'canceled',
];

type EditorState = {
  fulfillmentStatus: OrderFulfillmentStatus;
  trackingUrl: string;
  assignedTo: string;
  fulfillmentNotes: string;
};

type JsonRecord = Record<string, unknown>;

type SugarMixSummary = {
  white: number;
  blue: number;
  orange: number;
  red: number;
  total: number;
};

type BlankSticksSummary = {
  boxCount: number;
  piecesPerBox: number;
  stickSize: string;
  addressType: string;
  shippingRatePerBoxUsd: number;
  freeShipping: boolean;
};

type DisplayLineItem = {
  description: string;
  quantity: number | null;
  amountTotal: number | null;
  currency: string | null;
};

const formatDate = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const formatCurrency = (amountTotal: number | null, currency: string | null) => {
  if (amountTotal === null || !currency) {
    return 'n/a';
  }

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amountTotal / 100);
};

const formatUnitPrice = (unitPriceCents: number | null) =>
  unitPriceCents === null ? 'n/a' : `$${(unitPriceCents / 100).toFixed(2)}`;

const formatPricingTier = (pricingTier: OrderRecord['pricing_tier']) => {
  switch (pricingTier) {
    case 'plus_member':
      return 'Bloomjoy Plus';
    case 'standard':
      return 'Standard';
    default:
      return 'n/a';
  }
};

const formatNotificationStatus = (sentAt: string | null, error: string | null) => {
  if (sentAt) {
    return `Sent ${formatDate(sentAt)}`;
  }

  if (error) {
    return `Failed: ${error}`;
  }

  return 'Pending';
};

const formatAddressSnapshot = (address: OrderRecord['shipping_address']) => {
  if (!address) {
    return 'n/a';
  }

  return [
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.postal_code,
    address.country,
  ]
    .filter(Boolean)
    .join(', ') || 'n/a';
};

const getOrderReference = (order: OrderRecord) =>
  order.stripe_checkout_session_id || order.stripe_payment_intent_id || order.id;

const toEditorState = (order: OrderRecord): EditorState => ({
  fulfillmentStatus: order.fulfillment_status,
  trackingUrl: order.fulfillment_tracking_url ?? '',
  assignedTo: order.fulfillment_assigned_to ?? '',
  fulfillmentNotes: order.fulfillment_notes ?? '',
});

const asRecord = (value: unknown): JsonRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;

const getNumberValue = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getSugarMixSummary = (order: OrderRecord): SugarMixSummary | null => {
  for (const item of order.line_items) {
    const record = asRecord(item);
    const metadata = asRecord(record?.metadata);

    if (!metadata) {
      continue;
    }

    if (
      'white_kg' in metadata ||
      'blue_kg' in metadata ||
      'orange_kg' in metadata ||
      'red_kg' in metadata ||
      'total_kg' in metadata
    ) {
      return {
        white: getNumberValue(metadata.white_kg),
        blue: getNumberValue(metadata.blue_kg),
        orange: getNumberValue(metadata.orange_kg),
        red: getNumberValue(metadata.red_kg),
        total: getNumberValue(metadata.total_kg),
      };
    }
  }

  return null;
};

const getBlankSticksSummary = (order: OrderRecord): BlankSticksSummary | null => {
  for (const item of order.line_items) {
    const record = asRecord(item);
    const metadata = asRecord(record?.metadata);

    if (!metadata) {
      continue;
    }

    if ('box_count' in metadata || 'pieces_per_box' in metadata || 'stick_size' in metadata) {
      return {
        boxCount: getNumberValue(metadata.box_count),
        piecesPerBox: getNumberValue(metadata.pieces_per_box),
        stickSize: typeof metadata.stick_size === 'string' ? metadata.stick_size : 'n/a',
        addressType: typeof metadata.address_type === 'string' ? metadata.address_type : 'n/a',
        shippingRatePerBoxUsd: getNumberValue(metadata.shipping_rate_per_box_usd),
        freeShipping: Boolean(metadata.free_shipping),
      };
    }
  }

  return null;
};

const getDisplayLineItems = (order: OrderRecord): DisplayLineItem[] =>
  order.line_items
    .map((item) => asRecord(item))
    .filter((item): item is JsonRecord => Boolean(item))
    .map((item) => ({
      description: typeof item.description === 'string' ? item.description : 'Line item',
      quantity:
        typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : null,
      amountTotal:
        typeof item.amount_total === 'number' && Number.isFinite(item.amount_total)
          ? item.amount_total
          : null,
      currency: typeof item.currency === 'string' ? item.currency : order.currency,
    }));

const InfoCard = ({
  label,
  value,
}: {
  label: string;
  value: string;
}) => (
  <div className="rounded-lg border border-border/70 bg-background/60 p-3">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
    </p>
    <p className="mt-1 text-sm text-foreground">{value}</p>
  </div>
);

export default function AdminOrdersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | OrderFulfillmentStatus>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const {
    data: orders = [],
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['admin-orders', dateFrom, dateTo, statusFilter],
    queryFn: () =>
      fetchAdminOrders({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        fulfillmentStatus: statusFilter,
      }),
    staleTime: 1000 * 30,
  });

  const filteredOrders = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) {
      return orders;
    }

    return orders.filter((order) => {
      const ref = getOrderReference(order).toLowerCase();
      const id = order.id.toLowerCase();
      const email = (order.customer_email ?? '').toLowerCase();
      const customerName = (order.customer_name ?? '').toLowerCase();
      const orderType = order.order_type.toLowerCase();

      return (
        ref.includes(normalizedSearch) ||
        id.includes(normalizedSearch) ||
        email.includes(normalizedSearch) ||
        customerName.includes(normalizedSearch) ||
        orderType.includes(normalizedSearch)
      );
    });
  }, [orders, search]);

  const selectedOrder = filteredOrders.find((order) => order.id === selectedId) ?? null;
  const selectedSugarMix = selectedOrder ? getSugarMixSummary(selectedOrder) : null;
  const selectedBlankSticks = selectedOrder ? getBlankSticksSummary(selectedOrder) : null;
  const selectedLineItems = selectedOrder ? getDisplayLineItems(selectedOrder) : [];

  const selectOrder = (order: OrderRecord) => {
    setSelectedId(order.id);
    setEditor(toEditorState(order));
  };

  const refreshOrders = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
  };

  const saveOrder = async () => {
    if (!selectedOrder || !editor) {
      return;
    }

    setIsSaving(true);
    try {
      await updateOrderFulfillmentAdmin({
        orderId: selectedOrder.id,
        fulfillmentStatus: editor.fulfillmentStatus,
        trackingUrl: editor.trackingUrl.trim(),
        fulfillmentNotes: editor.fulfillmentNotes.trim(),
        assignedTo: editor.assignedTo.trim() || null,
      });

      trackEvent('admin_order_fulfillment_updated', {
        order_id: selectedOrder.id,
        fulfillment_status: editor.fulfillmentStatus,
      });
      toast.success('Order fulfillment updated.');
      await refreshOrders();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Unable to update order.';
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AppLayout>
      <section className="section-padding">
        <div className="container-page">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Admin
              </p>
              <h1 className="mt-2 font-display text-3xl font-bold text-foreground">Orders</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Search orders and manage internal fulfillment workflow.
              </p>
            </div>
            <Button variant="outline" onClick={refreshOrders} disabled={isFetching}>
              {isFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-4">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by email, customer, order type, or order ID"
            />
            <Input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
            <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as 'all' | OrderFulfillmentStatus)
              }
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">All fulfillment statuses</option>
              {fulfillmentOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Unable to load orders. Please try again.
            </div>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <table className="w-full">
                <thead className="border-b border-border bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Order
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Customer
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Payment
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Fulfillment
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        Loading orders...
                      </td>
                    </tr>
                  )}
                  {!isLoading && filteredOrders.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        No orders found.
                      </td>
                    </tr>
                  )}
                  {!isLoading &&
                    filteredOrders.map((order) => (
                      <tr
                        key={order.id}
                        className={`cursor-pointer border-b border-border/70 transition-colors hover:bg-muted/40 ${
                          selectedId === order.id ? 'bg-muted/50' : ''
                        }`}
                        onClick={() => selectOrder(order)}
                      >
                        <td className="px-4 py-3 text-sm text-foreground">{getOrderReference(order)}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          <div className="font-medium text-foreground">
                            {order.customer_name ?? 'Unknown'}
                          </div>
                          <div>{order.customer_email ?? 'Unknown'}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          <div className="font-medium">{formatCurrency(order.amount_total, order.currency)}</div>
                          <div className="text-muted-foreground">{order.status}</div>
                          <div className="text-xs text-muted-foreground">{order.order_type}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {order.fulfillment_status}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {formatDate(order.created_at)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <div className="card-elevated p-5">
              {!selectedOrder || !editor ? (
                <div className="text-sm text-muted-foreground">
                  Select an order to update fulfillment state and notes.
                </div>
              ) : (
                <div className="space-y-6">
                  <div>
                    <h2 className="font-semibold text-foreground">{getOrderReference(selectedOrder)}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedOrder.customer_name ?? 'Unknown customer'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedOrder.customer_email ?? 'No email on file'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Payment: {selectedOrder.status} | Total:{' '}
                      {formatCurrency(selectedOrder.amount_total, selectedOrder.currency)}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <InfoCard label="Order Type" value={selectedOrder.order_type} />
                    <InfoCard label="Pricing Tier" value={formatPricingTier(selectedOrder.pricing_tier)} />
                    <InfoCard label="Unit Price" value={formatUnitPrice(selectedOrder.unit_price_cents)} />
                    <InfoCard
                      label="Shipping Total"
                      value={formatCurrency(selectedOrder.shipping_total_cents, selectedOrder.currency)}
                    />
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Customer
                    </p>
                    <div className="rounded-lg border border-border/70 bg-background/60 p-3 text-sm text-foreground">
                      <p>Name: {selectedOrder.customer_name ?? 'n/a'}</p>
                      <p className="mt-1">Email: {selectedOrder.customer_email ?? 'n/a'}</p>
                      <p className="mt-1">Phone: {selectedOrder.customer_phone ?? 'n/a'}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Addresses
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border border-border/70 bg-background/60 p-3 text-sm text-foreground">
                        <p className="font-medium">Billing</p>
                        <p className="mt-2 text-muted-foreground">
                          {formatAddressSnapshot(selectedOrder.billing_address)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/70 bg-background/60 p-3 text-sm text-foreground">
                        <p className="font-medium">Shipping</p>
                        <p className="mt-2">{selectedOrder.shipping_name ?? 'n/a'}</p>
                        <p className="mt-1 text-muted-foreground">
                          {formatAddressSnapshot(selectedOrder.shipping_address)}
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          {selectedOrder.shipping_phone ?? 'No shipping phone'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Receipt
                      </p>
                      {selectedOrder.receipt_url ? (
                        <a
                          href={selectedOrder.receipt_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          Open receipt
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </div>
                    <div className="rounded-lg border border-border/70 bg-background/60 p-3 text-sm text-muted-foreground">
                      {selectedOrder.receipt_url ?? 'Stripe receipt URL not captured yet.'}
                    </div>
                  </div>

                  {selectedSugarMix ? (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Sugar Mix
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-border/70 bg-background/60 p-3 text-sm text-foreground">
                          <p>White: {selectedSugarMix.white} KG</p>
                          <p className="mt-1">Blue: {selectedSugarMix.blue} KG</p>
                          <p className="mt-1">Orange: {selectedSugarMix.orange} KG</p>
                          <p className="mt-1">Red: {selectedSugarMix.red} KG</p>
                        </div>
                        <div className="rounded-lg border border-border/70 bg-background/60 p-3 text-sm text-foreground">
                          <p className="font-medium">Total ordered</p>
                          <p className="mt-2 text-2xl font-semibold">{selectedSugarMix.total} KG</p>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {selectedBlankSticks ? (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Bloomjoy Branded Stick Details
                      </p>
                      <div className="rounded-lg border border-border/70 bg-background/60 p-3 text-sm text-foreground">
                        <p>Boxes: {selectedBlankSticks.boxCount}</p>
                        <p className="mt-1">Pieces per box: {selectedBlankSticks.piecesPerBox}</p>
                        <p className="mt-1">Stick size: {selectedBlankSticks.stickSize}</p>
                        <p className="mt-1">Address type: {selectedBlankSticks.addressType}</p>
                        <p className="mt-1">
                          Shipping rate per box: ${selectedBlankSticks.shippingRatePerBoxUsd.toFixed(2)}
                        </p>
                        <p className="mt-1">
                          Free shipping: {selectedBlankSticks.freeShipping ? 'Yes' : 'No'}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Line Items
                    </p>
                    <div className="space-y-2">
                      {selectedLineItems.length === 0 ? (
                        <div className="rounded-lg border border-border/70 bg-background/60 p-3 text-sm text-muted-foreground">
                          No line items captured.
                        </div>
                      ) : (
                        selectedLineItems.map((item, index) => (
                          <div
                            key={`${item.description}-${index}`}
                            className="rounded-lg border border-border/70 bg-background/60 p-3 text-sm text-foreground"
                          >
                            <p className="font-medium">{item.description}</p>
                            <p className="mt-1 text-muted-foreground">
                              Quantity: {item.quantity ?? 'n/a'}
                            </p>
                            <p className="mt-1 text-muted-foreground">
                              Total: {formatCurrency(item.amountTotal, item.currency)}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Notification Status
                    </p>
                    <div className="rounded-lg border border-border/70 bg-background/60 p-3 text-sm text-foreground">
                      <p>
                        Internal email:{' '}
                        {formatNotificationStatus(
                          selectedOrder.internal_notification_sent_at,
                          selectedOrder.internal_notification_error
                        )}
                      </p>
                      <p className="mt-2">
                        Customer confirmation:{' '}
                        {formatNotificationStatus(
                          selectedOrder.customer_confirmation_sent_at,
                          selectedOrder.customer_confirmation_error
                        )}
                      </p>
                      <p className="mt-2">
                        WeCom alert:{' '}
                        {formatNotificationStatus(
                          selectedOrder.wecom_alert_sent_at,
                          selectedOrder.wecom_alert_error
                        )}
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Fulfillment Status
                    </label>
                    <select
                      value={editor.fulfillmentStatus}
                      onChange={(event) =>
                        setEditor((prev) =>
                          prev
                            ? {
                                ...prev,
                                fulfillmentStatus: event.target
                                  .value as OrderFulfillmentStatus,
                              }
                            : prev
                        )
                      }
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {fulfillmentOptions.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Tracking URL
                    </label>
                    <Input
                      value={editor.trackingUrl}
                      onChange={(event) =>
                        setEditor((prev) =>
                          prev ? { ...prev, trackingUrl: event.target.value } : prev
                        )
                      }
                      placeholder="https://tracking.example.com/..."
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Assigned To (user ID)
                    </label>
                    <Input
                      value={editor.assignedTo}
                      onChange={(event) =>
                        setEditor((prev) =>
                          prev ? { ...prev, assignedTo: event.target.value } : prev
                        )
                      }
                      placeholder="Optional admin user UUID"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Internal Notes
                    </label>
                    <Textarea
                      rows={6}
                      value={editor.fulfillmentNotes}
                      onChange={(event) =>
                        setEditor((prev) =>
                          prev ? { ...prev, fulfillmentNotes: event.target.value } : prev
                        )
                      }
                      placeholder="Operational notes for fulfillment."
                    />
                  </div>

                  <Button onClick={saveOrder} disabled={isSaving}>
                    {isSaving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save Fulfillment'
                    )}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </AppLayout>
  );
}

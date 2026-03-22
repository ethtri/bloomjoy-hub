import { useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
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
    return '—';
  }

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amountTotal / 100);
};

const getOrderReference = (order: OrderRecord) =>
  order.stripe_checkout_session_id || order.stripe_payment_intent_id || order.id;

const toEditorState = (order: OrderRecord): EditorState => ({
  fulfillmentStatus: order.fulfillment_status,
  trackingUrl: order.fulfillment_tracking_url ?? '',
  assignedTo: order.fulfillment_assigned_to ?? '',
  fulfillmentNotes: order.fulfillment_notes ?? '',
});

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

      return (
        ref.includes(normalizedSearch) ||
        id.includes(normalizedSearch) ||
        email.includes(normalizedSearch)
      );
    });
  }, [orders, search]);

  const selectedOrder = filteredOrders.find((order) => order.id === selectedId) ?? null;

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
              placeholder="Search by customer email or order ID"
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
                          {order.customer_email ?? 'Unknown'}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">{order.status}</td>
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
                <div className="space-y-4">
                  <div>
                    <h2 className="font-semibold text-foreground">{getOrderReference(selectedOrder)}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedOrder.customer_email ?? 'Unknown customer'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Payment: {selectedOrder.status} • Total:{' '}
                      {formatCurrency(selectedOrder.amount_total, selectedOrder.currency)}
                    </p>
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

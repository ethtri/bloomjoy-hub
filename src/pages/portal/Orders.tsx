import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { fetchPortalOrders, type OrderRecord } from '@/lib/orders';

const formatCurrency = (amountTotal: number | null, currency: string | null) => {
  if (amountTotal === null || !currency) {
    return '—';
  }

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amountTotal / 100);
};

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

const getOrderReference = (order: OrderRecord) =>
  order.stripe_checkout_session_id || order.stripe_payment_intent_id || order.id;

const getLineItemsSummary = (lineItems: Array<Record<string, unknown>>) => {
  if (!lineItems.length) {
    return 'No line items';
  }

  return lineItems
    .slice(0, 2)
    .map((lineItem) => {
      const description = String(lineItem.description ?? 'Item');
      const quantity = lineItem.quantity ? ` x${lineItem.quantity}` : '';
      return `${description}${quantity}`;
    })
    .join(', ');
};

export default function OrdersPage() {
  const queryClient = useQueryClient();
  const {
    data: orders = [],
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['portal-orders'],
    queryFn: fetchPortalOrders,
    staleTime: 1000 * 30,
  });

  const refreshOrders = async () => {
    await queryClient.invalidateQueries({ queryKey: ['portal-orders'] });
  };

  return (
    <PortalLayout>
      <section className="section-padding">
        <div className="container-page">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="font-display text-3xl font-bold text-foreground">Order History</h1>
              <p className="mt-2 text-muted-foreground">
                View your past orders, tracking, and receipts.
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

          {error && (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Unable to load orders. Please try again.
            </div>
          )}

          <div className="mt-8">
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <table className="w-full">
                <thead className="border-b border-border bg-muted/50">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-foreground">
                      Order
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-foreground">
                      Date
                    </th>
                    <th className="hidden px-6 py-4 text-left text-sm font-semibold text-foreground md:table-cell">
                      Items
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-foreground">
                      Total
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-foreground">
                      Payment
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-foreground">
                      Fulfillment
                    </th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isLoading && (
                    <tr>
                      <td colSpan={7} className="px-6 py-10 text-center text-sm text-muted-foreground">
                        Loading orders...
                      </td>
                    </tr>
                  )}
                  {!isLoading && orders.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-10 text-center text-sm text-muted-foreground">
                        No orders yet.
                      </td>
                    </tr>
                  )}
                  {!isLoading &&
                    orders.map((order) => (
                      <tr key={order.id}>
                        <td className="px-6 py-4">
                          <span className="font-medium text-foreground">
                            {getOrderReference(order)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-muted-foreground">
                          {formatDate(order.created_at)}
                        </td>
                        <td className="hidden px-6 py-4 text-sm text-muted-foreground md:table-cell">
                          {getLineItemsSummary(order.line_items)}
                        </td>
                        <td className="px-6 py-4 font-medium text-foreground">
                          {formatCurrency(order.amount_total, order.currency)}
                        </td>
                        <td className="px-6 py-4">
                          <span className="rounded-full bg-sage-light px-2 py-1 text-xs font-medium text-sage">
                            {order.status}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                            {order.fulfillment_status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              asChild={Boolean(order.receipt_url)}
                              variant="ghost"
                              size="sm"
                              disabled={!order.receipt_url}
                            >
                              {order.receipt_url ? (
                                <a href={order.receipt_url} target="_blank" rel="noreferrer">
                                  Receipt
                                </a>
                              ) : (
                                <span>Receipt</span>
                              )}
                            </Button>
                            <Button
                              asChild={Boolean(order.fulfillment_tracking_url)}
                              variant="ghost"
                              size="sm"
                              disabled={!order.fulfillment_tracking_url}
                            >
                              {order.fulfillment_tracking_url ? (
                                <a
                                  href={order.fulfillment_tracking_url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <ExternalLink className="mr-1 h-4 w-4" />
                                  Track
                                </a>
                              ) : (
                                <span>Track</span>
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </PortalLayout>
  );
}

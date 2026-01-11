import { Link } from 'react-router-dom';
import { FileText, Download, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Layout } from '@/components/layout/Layout';

const orders = [
  {
    id: 'ORD-2025-001',
    date: '2025-01-08',
    items: ['Premium Cotton Candy Sugar (10x 1KG)', 'Cotton Candy Sticks (3x 100 pack)'],
    total: '$116.00',
    status: 'Delivered',
  },
  {
    id: 'ORD-2024-042',
    date: '2024-12-15',
    items: ['Premium Cotton Candy Sugar (5x 1KG)'],
    total: '$40.00',
    status: 'Delivered',
  },
  {
    id: 'ORD-2024-038',
    date: '2024-11-20',
    items: ['Bloomjoy Sweets Micro'],
    total: '$400.00',
    status: 'Delivered',
  },
];

export default function OrdersPage() {
  return (
    <Layout>
      {/* Breadcrumb */}
      <div className="border-b border-border bg-muted/30">
        <div className="container-page py-3">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/portal" className="hover:text-foreground">Portal</Link>
            <span>/</span>
            <span className="text-foreground">Orders</span>
          </nav>
        </div>
      </div>

      <section className="section-padding">
        <div className="container-page">
          <h1 className="font-display text-3xl font-bold text-foreground">Order History</h1>
          <p className="mt-2 text-muted-foreground">
            View your past orders, tracking, and invoices.
          </p>

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
                      Status
                    </th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td className="px-6 py-4">
                        <span className="font-medium text-foreground">{order.id}</span>
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">{order.date}</td>
                      <td className="hidden px-6 py-4 text-sm text-muted-foreground md:table-cell">
                        {order.items.join(', ')}
                      </td>
                      <td className="px-6 py-4 font-medium text-foreground">{order.total}</td>
                      <td className="px-6 py-4">
                        <span className="rounded-full bg-sage-light px-2 py-1 text-xs font-medium text-sage">
                          {order.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm">
                            <FileText className="mr-1 h-4 w-4" />
                            Invoice
                          </Button>
                          <Button variant="ghost" size="sm">
                            <ExternalLink className="mr-1 h-4 w-4" />
                            Track
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
    </Layout>
  );
}

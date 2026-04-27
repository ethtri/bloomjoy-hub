import { Link } from 'react-router-dom';
import { BarChart3, Handshake, ShieldCheck, ShoppingBag, LifeBuoy, Users, Building2, MonitorCog } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';

const adminModules = [
  {
    title: 'Orders',
    description: 'Search and manage operational order workflows.',
    icon: ShoppingBag,
    href: '/admin/orders',
  },
  {
    title: 'Support Queue',
    description: 'Triage concierge and parts-assistance requests.',
    icon: LifeBuoy,
    href: '/admin/support',
  },
  {
    title: 'Access',
    description: 'Manage users, Plus grants, global roles, machine reporting access, and audit.',
    icon: Users,
    href: '/admin/access',
  },
  {
    title: 'Partner Records',
    description: 'Manage reusable organizations and contacts used in partnership setup.',
    icon: Building2,
    href: '/admin/partner-records',
  },
  {
    title: 'Machines',
    description: 'Manage machine aliases, external machine IDs, tax status, and assignment readiness.',
    icon: MonitorCog,
    href: '/admin/machines',
  },
  {
    title: 'Partnerships',
    description: 'Configure guided agreement setup, participants, assigned machines, split terms, and preview.',
    icon: Handshake,
    href: '/admin/partnerships',
  },
  {
    title: 'Reporting',
    description: 'Monitor schedules, report exports, and sales sync status.',
    icon: BarChart3,
    href: '/admin/reporting',
  },
];

export default function AdminDashboardPage() {
  return (
    <AppLayout>
      <section className="border-b border-border bg-muted/20">
        <div className="container-page py-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Bloomjoy Operations
            </p>
            <h1 className="mt-2 font-display text-3xl font-bold text-foreground">
              Admin Home
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Use the admin tools navigation for quick switches between access, setup,
              reporting, and operations queues.
            </p>
          </div>
        </div>
      </section>

      <section className="section-padding">
        <div className="container-page">
          <div className="rounded-xl border border-sage/30 bg-sage-light px-4 py-3 text-sm text-sage">
            Admin workspace is active. Use the modules below for orders, support, access,
            partner records, machines, partnerships, and reporting operations.
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {adminModules.map((module) => (
              <div key={module.title} className="card-elevated p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <module.icon className="h-5 w-5 text-primary" />
                </div>
                <h2 className="mt-4 font-semibold text-foreground">{module.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{module.description}</p>
                {module.href !== '#' && (
                  <Button asChild variant="outline" size="sm" className="mt-4">
                    <Link to={module.href}>Open</Link>
                  </Button>
                )}
              </div>
            ))}
          </div>

          <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-sage" />
            Access enforced by `admin_roles` + `is_super_admin` policy checks.
          </div>
        </div>
      </section>
    </AppLayout>
  );
}

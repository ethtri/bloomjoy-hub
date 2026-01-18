import { User, MapPin, CreditCard, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { useAuth } from '@/contexts/AuthContext';

export default function AccountPage() {
  const { user } = useAuth();

  return (
    <PortalLayout>
      <section className="section-padding">
        <div className="container-page">
          <h1 className="font-display text-3xl font-bold text-foreground">Account Settings</h1>

          <div className="mt-8 grid gap-8 lg:grid-cols-3">
            {/* Profile */}
            <div className="lg:col-span-2">
              <div className="card-elevated p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <h2 className="font-display text-lg font-semibold text-foreground">Profile</h2>
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-foreground">Email</label>
                    <Input value={user?.email || ''} disabled className="mt-1" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">Name</label>
                    <Input placeholder="Your name" className="mt-1" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">Company</label>
                    <Input placeholder="Company name (optional)" className="mt-1" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">Phone</label>
                    <Input placeholder="Phone number" className="mt-1" />
                  </div>
                </div>
                <Button className="mt-6">Save Changes</Button>
              </div>

              {/* Shipping */}
              <div className="mt-6 card-elevated p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <MapPin className="h-5 w-5 text-primary" />
                  </div>
                  <h2 className="font-display text-lg font-semibold text-foreground">
                    Shipping Address
                  </h2>
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-foreground">Street Address</label>
                    <Input placeholder="123 Main St" className="mt-1" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">City</label>
                    <Input placeholder="City" className="mt-1" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">State</label>
                    <Input placeholder="State" className="mt-1" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">ZIP Code</label>
                    <Input placeholder="12345" className="mt-1" />
                  </div>
                </div>
                <Button className="mt-6">Update Address</Button>
              </div>
            </div>

            {/* Billing */}
            <div>
              <div className="card-elevated p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <CreditCard className="h-5 w-5 text-primary" />
                  </div>
                  <h2 className="font-display text-lg font-semibold text-foreground">Billing</h2>
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                  Manage your subscription and payment methods through the Stripe customer portal.
                </p>
                <Button variant="outline" className="mt-4 w-full">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Manage Billing
                </Button>
              </div>

              <div className="mt-6 card-elevated p-6">
                <h3 className="font-semibold text-foreground">Membership</h3>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Plan</span>
                  <span className="font-semibold text-foreground">Plus Basic</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <span className="rounded-full bg-sage-light px-2 py-0.5 text-xs font-semibold text-sage">
                    Active
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Next billing</span>
                  <span className="text-sm text-foreground">Feb 11, 2025</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PortalLayout>
  );
}

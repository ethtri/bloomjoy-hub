import { Link } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';

export default function BillingCancellationPage() {
  return (
    <Layout>
      <section className="bg-gradient-to-b from-cream to-background section-padding">
        <div className="container-page">
          <h1 className="font-display text-4xl font-bold text-foreground">
            Billing and Cancellation
          </h1>
          <p className="mt-4 max-w-3xl text-muted-foreground">
            Last updated: February 23, 2026. This page explains how Bloomjoy Plus subscriptions are
            billed, renewed, and canceled.
          </p>
        </div>
      </section>

      <section className="section-padding pt-0">
        <div className="container-page">
          <div className="card-elevated max-w-4xl space-y-8 p-6 sm:p-8">
            <section className="space-y-3">
              <h2 className="font-display text-2xl font-semibold text-foreground">
                Subscription billing
              </h2>
              <p className="text-muted-foreground">
                Bloomjoy Plus Basic is billed monthly based on machine count at checkout. Charges
                recur automatically each billing cycle unless canceled.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-display text-2xl font-semibold text-foreground">
                Managing billing details
              </h2>
              <p className="text-muted-foreground">
                Active subscribers can manage payment methods, invoices, and cancellation through
                Stripe Customer Portal from their account page.
              </p>
              <Button asChild variant="outline">
                <Link to="/portal/account">Go to account billing</Link>
              </Button>
            </section>

            <section className="space-y-3">
              <h2 className="font-display text-2xl font-semibold text-foreground">
                How cancellation works
              </h2>
              <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
                <li>Cancel from Stripe Customer Portal via your account billing settings.</li>
                <li>Cancellation applies at the end of the current paid billing period.</li>
                <li>
                  After cancellation, Plus-only features are removed when the current period ends.
                </li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="font-display text-2xl font-semibold text-foreground">
                Refund policy
              </h2>
              <p className="text-muted-foreground">
                Unless required by law, subscription charges already billed for the active period are
                not prorated after cancellation.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-display text-2xl font-semibold text-foreground">
                Billing questions
              </h2>
              <p className="text-muted-foreground">
                For billing support, use the Contact page and include the email address tied to your
                subscription.
              </p>
            </section>
          </div>
        </div>
      </section>
    </Layout>
  );
}

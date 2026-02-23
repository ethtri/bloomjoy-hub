import { Layout } from '@/components/layout/Layout';

export default function TermsPage() {
  return (
    <Layout>
      <section className="bg-gradient-to-b from-cream to-background section-padding">
        <div className="container-page">
          <h1 className="font-display text-4xl font-bold text-foreground">Terms of Service</h1>
          <p className="mt-4 max-w-3xl text-muted-foreground">
            Last updated: February 23, 2026. These terms govern use of the Bloomjoy Sweets website,
            storefront, and member portal.
          </p>
        </div>
      </section>

      <section className="section-padding pt-0">
        <div className="container-page">
          <div className="card-elevated max-w-4xl space-y-8 p-6 sm:p-8">
            <section className="space-y-3">
              <h2 className="font-display text-2xl font-semibold text-foreground">
                Use of services
              </h2>
              <p className="text-muted-foreground">
                You agree to use this site and portal for lawful business purposes. You are
                responsible for account security and for activity under your account credentials.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-display text-2xl font-semibold text-foreground">
                Products and availability
              </h2>
              <p className="text-muted-foreground">
                Product content, availability, and pricing may change without notice. We may limit
                quantities, reject, or cancel orders when necessary, including for pricing errors,
                fraud concerns, or operational constraints.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-display text-2xl font-semibold text-foreground">
                Membership and support boundaries
              </h2>
              <p className="text-muted-foreground">
                Bloomjoy Plus is optional and provides onboarding, training, and concierge support
                benefits. Manufacturer technical support remains separate. Bloomjoy support is not a
                24/7 service unless explicitly stated in a separate written agreement.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-display text-2xl font-semibold text-foreground">
                Billing and cancellations
              </h2>
              <p className="text-muted-foreground">
                Subscription billing and cancellation are managed through Stripe Customer Portal.
                See the Billing and Cancellation page for details on renewal and cancellation timing.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-display text-2xl font-semibold text-foreground">
                Disclaimer and limitation of liability
              </h2>
              <p className="text-muted-foreground">
                Services are provided on an as-available basis. To the maximum extent allowed by
                law, Bloomjoy Sweets is not liable for indirect, incidental, special, or
                consequential damages arising from use of this site, portal, or related services.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-display text-2xl font-semibold text-foreground">
                Contact
              </h2>
              <p className="text-muted-foreground">
                Questions about these terms can be submitted through the website Contact page.
              </p>
            </section>
          </div>
        </div>
      </section>
    </Layout>
  );
}

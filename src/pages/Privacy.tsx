import { Layout } from '@/components/layout/Layout';

export default function PrivacyPage() {
  return (
    <Layout>
      <section className="bg-gradient-to-b from-cream to-background section-padding">
        <div className="container-page">
          <h1 className="font-display text-4xl font-bold text-foreground">Privacy Policy</h1>
          <p className="mt-4 max-w-3xl text-muted-foreground">
            Last updated: February 23, 2026. This policy explains how Bloomjoy Sweets collects,
            uses, and protects personal information when you use this website and member portal.
          </p>
        </div>
      </section>

      <section className="section-padding pt-0">
        <div className="container-page">
          <div className="card-elevated max-w-4xl space-y-8 p-6 sm:p-8">
            <section className="space-y-3">
              <h2 className="font-display text-2xl font-semibold text-foreground">
                Information we collect
              </h2>
              <p className="text-muted-foreground">
                We collect information you submit through forms and account settings, such as name,
                email, phone, shipping details, and support requests. We also collect transaction
                and subscription metadata needed to operate ordering and membership features.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-display text-2xl font-semibold text-foreground">
                How we use information
              </h2>
              <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
                <li>Provide products, member services, onboarding, and support.</li>
                <li>Process purchases, subscriptions, and account operations.</li>
                <li>Respond to requests and improve site and portal reliability.</li>
                <li>Maintain records needed for operations, security, and compliance.</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="font-display text-2xl font-semibold text-foreground">
                Payments and third-party services
              </h2>
              <p className="text-muted-foreground">
                Billing is processed by Stripe. We do not store full payment card numbers on this
                site. We also use third-party infrastructure providers to host app data and deliver
                account functionality.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-display text-2xl font-semibold text-foreground">
                Data sharing
              </h2>
              <p className="text-muted-foreground">
                We share data only as needed to operate services, complete transactions, provide
                support, and meet legal obligations. We do not sell personal information.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-display text-2xl font-semibold text-foreground">
                Data retention and security
              </h2>
              <p className="text-muted-foreground">
                We retain information for as long as needed to provide services and satisfy legal
                or operational requirements. We use reasonable technical and organizational measures
                to protect account and transaction data.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="font-display text-2xl font-semibold text-foreground">
                Contact
              </h2>
              <p className="text-muted-foreground">
                For privacy questions or requests, contact us through the website contact form on
                the Contact page.
              </p>
            </section>
          </div>
        </div>
      </section>
    </Layout>
  );
}

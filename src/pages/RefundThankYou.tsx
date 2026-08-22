import { CheckCircle2, Mail, Sparkles } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';

export default function RefundThankYouPage() {
  const [searchParams] = useSearchParams();
  const reference = searchParams.get('ref')?.trim() ?? '';
  const isDemo = searchParams.get('demo') === 'on';

  return (
    <Layout>
      <section className="section-padding bg-gradient-to-b from-pink-50 via-background to-background">
        <div className="container-page">
          <div className="mx-auto max-w-2xl rounded-2xl border border-pink-200 bg-white p-6 text-center shadow-sm sm:p-8">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-pink-100 text-pink-700">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-pink-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">
              <Sparkles className="h-3.5 w-3.5" />
              Request received
            </div>
            <h1 className="mt-4 font-display text-3xl font-bold text-foreground sm:text-4xl">
              We received your refund request.
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
              We are sorry the machine did not work as expected. Most requests are reviewed within
              5 business days, and we will email you if we need one specific detail.
            </p>

            <div className="mx-auto mt-6 max-w-sm rounded-xl border border-pink-200 bg-pink-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-pink-700">
                Reference
              </p>
              <p className="mt-1 font-mono text-lg font-semibold text-foreground">
                {reference || 'Sent by email'}
              </p>
              {isDemo && (
                <p className="mt-2 text-xs text-pink-800">
                  Demo mode did not create a real refund case.
                </p>
              )}
            </div>

            <div className="mx-auto mt-6 flex max-w-xl items-start gap-3 rounded-xl border border-border bg-muted/25 p-4 text-left text-sm text-muted-foreground">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="space-y-2">
                <p>
                  Keep this reference handy. You do not need to submit another form for this
                  purchase. We will compare your details with the machine's payment records.
                </p>
                <p>
                  We will review the card payment against the machine's payment records before a
                  manager makes a separate refund decision.
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild>
                <Link to="/">Back to Bloomjoy</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/refunds/request">Report a different purchase</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}

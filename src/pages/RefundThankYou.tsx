import { CheckCircle2, Mail, Sparkles } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';

export default function RefundThankYouPage() {
  const [searchParams] = useSearchParams();
  const reference = searchParams.get('ref')?.trim() ?? '';

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
              Thank you for giving us a chance to make it right.
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
              We are sorry your Bloomjoy experience was not as sweet as it should have been. Our
              team will review your request with care and follow up by email. Our target is to
              complete refund reviews within 5 business days.
            </p>

            {reference && (
              <div className="mx-auto mt-6 max-w-sm rounded-xl border border-pink-200 bg-pink-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-pink-700">
                  Reference
                </p>
                <p className="mt-1 font-mono text-lg font-semibold text-foreground">{reference}</p>
              </div>
            )}

            <div className="mx-auto mt-6 flex max-w-xl items-start gap-3 rounded-xl border border-border bg-muted/25 p-4 text-left text-sm text-muted-foreground">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p>
                If we need one more detail, we will ask by email. You can reply directly to that
                message and include any photos or timing details that might help us review quickly.
              </p>
            </div>

            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild>
                <Link to="/refunds/request">Submit another request</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/">Back to Bloomjoy</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}

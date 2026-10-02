import { useRefundCustomerLanguage } from '@/hooks/useRefundCustomerLanguage';
import { RefundCustomerLanguageToggle } from '@/components/refunds/RefundCustomerLanguageToggle';
import { CheckCircle2, Mail, Sparkles } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import {
  getRefundSessionStorage,
  readRefundSubmissionReceipt,
  resolveRefundThankYouContext,
  type RefundThankYouNavigationState,
} from '@/lib/refundSubmissionRecovery';

export default function RefundThankYouPage() {
  const { locale, setLocale, t } = useRefundCustomerLanguage();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const navigationState = location.state as RefundThankYouNavigationState | null;
  const savedReceipt = readRefundSubmissionReceipt(getRefundSessionStorage());
  const { reference, statusToken, paymentMethod, resolutionMethod, requiresManagerReview } = resolveRefundThankYouContext({
    navigationState,
    hasQueryReference: searchParams.has('ref'),
    queryReference: searchParams.get('ref'),
    savedReceipt,
  });
  const hasStatusLink = typeof statusToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(statusToken);
  const isDemo = searchParams.get('demo') === 'on';

  return (
    <Layout>
      <section lang={locale} className="section-padding bg-gradient-to-b from-pink-50 via-background to-background">
        <div className="container-page">
          <RefundCustomerLanguageToggle locale={locale} onChange={setLocale} />
          <div className="mx-auto max-w-2xl rounded-2xl border border-pink-200 bg-white p-6 text-center shadow-sm sm:p-8">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-pink-100 text-pink-700">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-pink-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">
              <Sparkles className="h-3.5 w-3.5" />{t("Request received")}</div>
            <h1 className="mt-4 font-display text-3xl font-bold text-foreground sm:text-4xl">
              {resolutionMethod === 'gift_card' ? t("A sweeter visit starts here.") : t("We received your refund request.")}
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
              {resolutionMethod === 'gift_card'
                ? t("Thanks for letting us make it right. We have your gift card request and will email you with the next update.")
                : t("We are sorry the machine did not work as expected. Most requests are reviewed within 5 business days, and we will email you if we need one specific detail.")}
            </p>

            <div className="mx-auto mt-6 max-w-sm rounded-xl border border-pink-200 bg-pink-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-pink-700">{t("Reference")}</p>
              <p className="mt-1 font-mono text-lg font-semibold text-foreground">
                {reference || t("Sent by email")}
              </p>
              {isDemo && (
                <p className="mt-2 text-xs text-pink-800">{t("Demo mode did not create a real refund case.")}</p>
              )}
            </div>

            <div className="mx-auto mt-6 flex max-w-xl items-start gap-3 rounded-xl border border-border bg-muted/25 p-4 text-left text-sm text-muted-foreground">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="space-y-2">
                <p>{t("Keep this reference handy. You do not need to submit another form for this purchase.")}</p>
                {requiresManagerReview ? <p>{t('Your request will be reviewed by a manager. We will email you when the review is complete.')}</p> : resolutionMethod === 'gift_card' ? (
                  <p>{t("Your gift card request is saved. Gift cards are usually emailed within a few hours. If review or delivery takes longer, your status page will keep you updated.")}</p>
                ) : paymentMethod === 'cash' ? (
                  <p>{t("A manager will review the cash purchase details before deciding what happens next.")}</p>
                ) : paymentMethod === 'card' ? (
                  <p>{t("We will review the card payment against the machine's payment records before a manager makes a separate refund decision.")}</p>
                ) : (
                  <p>{t("A manager will review the purchase details before deciding what happens next.")}</p>
                )}
              </div>
            </div>

            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              {hasStatusLink && (
                <Button asChild>
                  <Link to={`/refunds/status#token=${statusToken}`}>{t("Check refund status")}</Link>
                </Button>
              )}
              <Button asChild variant={hasStatusLink ? 'outline' : 'default'}>
                <Link to="/">{t("Back to Bloomjoy")}</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link to="/refunds/request">{t("Report a different purchase")}</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}

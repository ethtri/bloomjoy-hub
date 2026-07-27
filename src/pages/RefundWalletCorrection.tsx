import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clock3,
  CreditCard,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  inspectRefundWalletCorrection,
  isLocalUatDemoForced,
  submitRefundWalletCorrection,
  type RefundWalletCorrectionContext,
  type RefundWalletCorrectionResolution,
  type SubmitRefundWalletCorrectionInput,
} from '@/lib/refundOperations';

const formatCurrency = (cents: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);

const localInputParts = (
  context: RefundWalletCorrectionContext
): { incidentDate: string; incidentTime: string } => {
  const localValue = context.incidentLocalDateTime?.trim();
  if (localValue && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(localValue)) {
    return {
      incidentDate: localValue.slice(0, 10),
      incidentTime: localValue.slice(11, 16),
    };
  }

  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: context.locationTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(new Date(context.incidentAt))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value])
    );

    return {
      incidentDate: `${parts.year}-${parts.month}-${parts.day}`,
      incidentTime: `${parts.hour}:${parts.minute}`,
    };
  } catch {
    return { incidentDate: '', incidentTime: '' };
  }
};

const demoContext = (): RefundWalletCorrectionContext => ({
  state: 'ready',
  expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  version: 1,
  publicReference: 'RF-WALLET-DEMO',
  machineLabel: 'Cotton Candy 01',
  locationName: 'Mall Atrium',
  locationTimezone: 'America/Los_Angeles',
  paymentAmountCents: 700,
  incidentLocalDateTime: '2026-07-26T14:30',
  incidentAt: '2026-07-26T21:30:00.000Z',
});

const ResultPanel = ({
  publicReference,
  resolution,
}: {
  publicReference: string;
  resolution: RefundWalletCorrectionResolution;
}) => {
  const matchReady = resolution === 'match_ready';
  const fallbackEligible = resolution === 'fallback_eligible';

  return (
    <div className="mx-auto max-w-2xl rounded-[2rem] border border-pink-100 bg-white p-7 shadow-[0_24px_80px_-42px_rgba(137,48,80,0.45)] sm:p-10">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
        <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
      </div>
      <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-pink-700">
        Details received
      </p>
      <h1 className="mt-2 font-display text-3xl text-slate-950 sm:text-4xl">
        We automatically re-checked your purchase.
      </h1>
      <p className="mt-4 text-base leading-7 text-slate-600">
        {matchReady
          ? 'We found one high-confidence transaction. The machine manager has been notified and can now make the refund decision.'
          : fallbackEligible
            ? 'We still could not identify one transaction with enough confidence. Your request is now ready for the alternative resolution route.'
            : 'Your corrected details are saved. Our system will retry the transaction check without asking the machine manager to investigate your card details.'}
      </p>
      <div className="mt-7 rounded-2xl bg-pink-50 px-5 py-4 text-sm text-slate-700">
        Reference: <span className="font-bold text-slate-950">{publicReference}</span>
      </div>
      <p className="mt-5 text-sm leading-6 text-slate-500">
        You do not need to submit another form. We will email you when the refund request is
        resolved.
      </p>
    </div>
  );
};

export default function RefundWalletCorrectionPage() {
  const [searchParams] = useSearchParams();
  const token = (searchParams.get('token') ?? '').trim();
  const isDemoMode = isLocalUatDemoForced();
  const [form, setForm] = useState<SubmitRefundWalletCorrectionInput>({
    token,
    walletType: 'apple_pay',
    cardLast4: '',
    incidentDate: '',
    incidentTime: '',
    amountConfirmed: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{
    publicReference: string;
    resolution: RefundWalletCorrectionResolution;
  } | null>(null);

  const {
    data: liveContext,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['refund-wallet-correction', token],
    queryFn: () => inspectRefundWalletCorrection(token),
    enabled: Boolean(token) && !isDemoMode,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const context = useMemo(
    () => (isDemoMode ? demoContext() : liveContext ?? null),
    [isDemoMode, liveContext]
  );

  useEffect(() => {
    if (!context) return;
    const localParts = localInputParts(context);
    setForm((current) => ({
      ...current,
      token,
      ...localParts,
    }));
  }, [context, token]);

  const updateForm = <Key extends keyof SubmitRefundWalletCorrectionInput>(
    key: Key,
    value: SubmitRefundWalletCorrectionInput[Key]
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!context) return;
    if (!/^[0-9]{4}$/.test(form.cardLast4)) {
      toast.error('Enter the four digits shown for the card inside your mobile wallet.');
      return;
    }
    if (!form.incidentDate || !form.incidentTime) {
      toast.error('Enter your approximate purchase date and time.');
      return;
    }
    if (!form.amountConfirmed) {
      toast.error(`Confirm that the purchase amount was ${formatCurrency(context.paymentAmountCents)}.`);
      return;
    }

    setIsSubmitting(true);
    try {
      const response = isDemoMode
        ? {
            publicReference: context.publicReference,
            resolution: (searchParams.get('result') === 'fallback'
              ? 'fallback_eligible'
              : searchParams.get('result') === 'review'
                ? 'still_reviewing'
                : 'match_ready') as RefundWalletCorrectionResolution,
          }
        : await submitRefundWalletCorrection(form);
      setResult(response);
    } catch (submitError) {
      toast.error(
        submitError instanceof Error
          ? submitError.message
          : 'Unable to save the corrected wallet details.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Layout>
      <main className="min-h-[calc(100vh-7rem)] bg-[radial-gradient(circle_at_top_left,_#fff1f5,_transparent_36%),linear-gradient(180deg,#fffafd_0%,#fff_100%)] px-4 py-12 sm:py-16">
        {result ? (
          <ResultPanel {...result} />
        ) : isLoading && !isDemoMode ? (
          <div
            className="mx-auto flex max-w-xl items-center justify-center gap-3 rounded-3xl border border-pink-100 bg-white p-10 text-slate-600"
            role="status"
          >
            <Loader2 className="h-5 w-5 animate-spin text-pink-600" aria-hidden="true" />
            Opening your secure wallet-detail form…
          </div>
        ) : (!token && !isDemoMode) || error || !context ? (
          <div className="mx-auto max-w-xl rounded-[2rem] border border-amber-200 bg-white p-8 shadow-sm sm:p-10">
            <TriangleAlert className="h-10 w-10 text-amber-600" aria-hidden="true" />
            <h1 className="mt-5 font-display text-3xl text-slate-950">
              This secure link is no longer available.
            </h1>
            <p className="mt-4 leading-7 text-slate-600">
              It may have expired or already been used. Reply to the Bloomjoy refund email so
              we can continue helping with your existing request.
            </p>
          </div>
        ) : (
          <div className="mx-auto grid max-w-5xl gap-7 lg:grid-cols-[0.82fr_1.18fr]">
            <section className="rounded-[2rem] bg-slate-950 p-7 text-white sm:p-9">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
                <Smartphone className="h-6 w-6 text-pink-200" aria-hidden="true" />
              </div>
              <p className="mt-7 text-xs font-bold uppercase tracking-[0.18em] text-pink-200">
                Refund {context.publicReference}
              </p>
              <h1 className="mt-3 font-display text-3xl leading-tight sm:text-4xl">
                Check the card details shown inside your mobile wallet.
              </h1>
              <p className="mt-5 text-base leading-7 text-slate-300">
                Apple Pay and Google Pay may use a virtual card number that is different from
                your physical card. These details give our system another chance to find the
                correct purchase automatically.
              </p>
              <dl className="mt-8 space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5 text-sm">
                <div>
                  <dt className="text-slate-400">Machine</dt>
                  <dd className="mt-1 font-semibold text-white">{context.machineLabel}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Location</dt>
                  <dd className="mt-1 font-semibold text-white">{context.locationName}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Purchase amount</dt>
                  <dd className="mt-1 font-semibold text-white">
                    {formatCurrency(context.paymentAmountCents)}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="rounded-[2rem] border border-pink-100 bg-white p-6 shadow-[0_24px_80px_-42px_rgba(137,48,80,0.45)] sm:p-9">
              <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <p>
                  Enter only the virtual card’s last four digits. We will never ask for the
                  full card number, security code, expiration date, wallet password, or a
                  screenshot.
                </p>
              </div>

              <form className="mt-7 space-y-6" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="walletType">Mobile wallet used</Label>
                  <select
                    id="walletType"
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={form.walletType}
                    onChange={(event) =>
                      updateForm(
                        'walletType',
                        event.target.value as SubmitRefundWalletCorrectionInput['walletType']
                      )
                    }
                  >
                    <option value="apple_pay">Apple Pay</option>
                    <option value="google_pay">Google Pay</option>
                    <option value="other_wallet">Another mobile wallet</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cardLast4">Virtual card last 4</Label>
                  <div className="relative">
                    <CreditCard
                      className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-slate-400"
                      aria-hidden="true"
                    />
                    <Input
                      id="cardLast4"
                      className="pl-10 text-lg tracking-[0.35em]"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={4}
                      pattern="[0-9]{4}"
                      placeholder="0000"
                      value={form.cardLast4}
                      onChange={(event) =>
                        updateForm('cardLast4', event.target.value.replace(/\D/g, '').slice(0, 4))
                      }
                      required
                    />
                  </div>
                  <p className="text-sm leading-6 text-slate-500">
                    In Apple Wallet, open the card and view Card Number. Use the last four of
                    the Apple Pay number—not the physical card.
                  </p>
                </div>

                <fieldset>
                  <legend className="text-sm font-medium text-slate-900">
                    Approximate purchase time
                  </legend>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="incidentDate" className="sr-only">
                        Purchase date
                      </Label>
                      <Input
                        id="incidentDate"
                        type="date"
                        value={form.incidentDate}
                        onChange={(event) => updateForm('incidentDate', event.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="incidentTime" className="sr-only">
                        Purchase time
                      </Label>
                      <div className="relative">
                        <Clock3
                          className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-slate-400"
                          aria-hidden="true"
                        />
                        <Input
                          id="incidentTime"
                          className="pl-10"
                          type="time"
                          value={form.incidentTime}
                          onChange={(event) => updateForm('incidentTime', event.target.value)}
                          required
                        />
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    Use the location’s local time. An estimate is okay.
                  </p>
                </fieldset>

                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-pink-100 bg-pink-50/60 p-4">
                  <input
                    className="mt-1 h-4 w-4 rounded border-pink-300 text-pink-600 focus:ring-pink-500"
                    type="checkbox"
                    checked={form.amountConfirmed}
                    onChange={(event) => updateForm('amountConfirmed', event.target.checked)}
                  />
                  <span className="text-sm leading-6 text-slate-700">
                    I confirm the purchase amount was{' '}
                    <strong>{formatCurrency(context.paymentAmountCents)}</strong>.
                  </span>
                </label>

                <Button
                  type="submit"
                  size="lg"
                  className="h-12 w-full rounded-full bg-pink-600 text-base font-bold hover:bg-pink-700"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
                      Checking transactions…
                    </>
                  ) : (
                    <>
                      <LockKeyhole className="mr-2 h-5 w-5" aria-hidden="true" />
                      Save and check my purchase
                    </>
                  )}
                </Button>
              </form>
            </section>
          </div>
        )}
      </main>
    </Layout>
  );
}

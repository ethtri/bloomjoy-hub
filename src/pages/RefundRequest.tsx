import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Loader2, MapPin, ShieldCheck, Sparkles } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { isEdgeFunctionError } from '@/lib/edgeFunctions';
import {
  fetchRefundMachineOptions,
  buildLocalRefundMachineOptions,
  isLocalUatDemoForced,
  startRefundQrClaim,
  submitRefundRequest,
  type RefundPaymentMethod,
  type RefundQrClaim,
} from '@/lib/refundOperations';

const emptyForm = {
  machineId: '',
  customerName: '',
  customerEmail: '',
  customerPhone: '',
  zellePaymentContact: '',
  incidentDate: '',
  incidentTime: '',
  paymentMethod: 'card' as RefundPaymentMethod,
  paymentAmount: '',
  cardLast4: '',
  cardWalletUsed: false,
  issueSummary: '',
};

const hasValidIncidentLocalTime = (incidentDate: string, incidentTime: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(incidentDate) && /^\d{2}:\d{2}$/.test(incidentTime);

const isPlaceholderRefundLocationLabel = (value: string) => {
  const normalized = value.trim().toLocaleLowerCase();

  return normalized === 'unmapped'
    || normalized === 'unknown'
    || normalized.startsWith('unmapped ')
    || normalized.startsWith('unknown ');
};

const formatMachineOption = (locationName: string, machineLabel: string) => {
  const normalizedLocationName = locationName.trim();
  const normalizedMachineLabel = machineLabel.trim();

  if (
    !normalizedLocationName
    || isPlaceholderRefundLocationLabel(normalizedLocationName)
    || normalizedLocationName.toLocaleLowerCase() === normalizedMachineLabel.toLocaleLowerCase()
  ) {
    return normalizedMachineLabel;
  }

  return `${normalizedLocationName} - ${normalizedMachineLabel}`;
};

const formatQrOpenedTime = (openedAt: string, timeZone: string) => {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
      timeZoneName: 'short',
    }).format(new Date(openedAt));
  } catch {
    return 'the time you scanned the code';
  }
};

export default function RefundRequestPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [qrSubmissionError, setQrSubmissionError] = useState(false);
  const isDemoMode = isLocalUatDemoForced();
  const qrCode = (searchParams.get('qr') ?? '').trim();
  const [emailContextToken] = useState(() => (searchParams.get('emailContext') ?? '').trim());
  const hasQrCode = Boolean(qrCode);
  const hasEmailContext = Boolean(emailContextToken);

  useEffect(() => {
    if (!hasEmailContext || typeof window === 'undefined') return;
    const safeUrl = new URL(window.location.href);
    safeUrl.searchParams.delete('emailContext');
    window.history.replaceState(
      window.history.state,
      '',
      `${safeUrl.pathname}${safeUrl.search}${safeUrl.hash}`
    );
  }, [hasEmailContext]);

  const demoQrClaim = useMemo<RefundQrClaim | null>(() => {
    if (!isDemoMode || !hasQrCode) return null;

    const machine = buildLocalRefundMachineOptions()[0];
    if (!machine) return null;
    const openedAt = new Date();

    return {
      claimToken: 'refund_qr_demo_claim_token_00000000000001',
      openedAt: openedAt.toISOString(),
      expiresAt: new Date(openedAt.getTime() + 30 * 60 * 1000).toISOString(),
      ttlMinutes: 30,
      machine,
    };
  }, [hasQrCode, isDemoMode]);

  const {
    data: liveQrClaim,
    isLoading: isLoadingQrClaim,
    error: qrClaimError,
  } = useQuery({
    queryKey: ['refund-qr-claim', qrCode],
    queryFn: () => startRefundQrClaim(qrCode),
    enabled: hasQrCode && !isDemoMode,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const qrClaim = demoQrClaim ?? liveQrClaim ?? null;

  const {
    data: liveMachines = [],
    isLoading: isLoadingMachines,
    error: machineError,
  } = useQuery({
    queryKey: ['public-refund-machine-options'],
    queryFn: fetchRefundMachineOptions,
    enabled: !isDemoMode && !hasQrCode,
    staleTime: 1000 * 60 * 5,
  });
  const machines = useMemo(
    () =>
      qrClaim
        ? [qrClaim.machine]
        : isDemoMode
          ? buildLocalRefundMachineOptions()
          : liveMachines,
    [isDemoMode, liveMachines, qrClaim]
  );
  const hasAvailableMachines = machines.length > 0;
  const hasNoLiveMachineOptions =
    !hasQrCode &&
    !isDemoMode &&
    !isLoadingMachines &&
    !machineError &&
    !hasAvailableMachines;
  const isLoadingMachineContext = hasQrCode ? isLoadingQrClaim : isLoadingMachines;
  const hasQrClaimError = hasQrCode && !isLoadingQrClaim && Boolean(qrClaimError);
  const canShowForm = !hasQrCode || Boolean(qrClaim);

  useEffect(() => {
    if (!qrClaim) return;

    setForm((current) => {
      if (current.machineId === qrClaim.machine.machineId) return current;
      return { ...current, machineId: qrClaim.machine.machineId };
    });
  }, [qrClaim]);

  const selectedMachine = useMemo(
    () => machines.find((machine) => machine.machineId === form.machineId) ?? null,
    [form.machineId, machines]
  );

  const updateForm = (key: keyof typeof form, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (hasNoLiveMachineOptions) {
      toast.error('This refund form is not open for customer submissions yet.');
      return;
    }

    if (hasQrCode && !qrClaim) {
      toast.error('Scan the machine refund code again or use the regular refund form.');
      return;
    }

    if (!form.machineId) {
      toast.error('Choose the machine location so we can route your request.');
      return;
    }

    if (!hasValidIncidentLocalTime(form.incidentDate, form.incidentTime)) {
      toast.error('Enter the date and time when the issue happened.');
      return;
    }

    if (!form.customerName.trim()) {
      toast.error('Enter your name so we know who to help.');
      return;
    }

    if (!form.paymentAmount.trim()) {
      toast.error('Enter the amount you paid.');
      return;
    }

    if (form.paymentMethod === 'card' && !/^[0-9]{4}$/.test(form.cardLast4.trim())) {
      toast.error('Enter the last 4 digits shown for the card payment.');
      return;
    }

    if (form.paymentMethod === 'cash' && !form.zellePaymentContact.trim()) {
      toast.error('Enter the phone number or email connected to your Zelle account.');
      return;
    }

    setIsSubmitting(true);
    setQrSubmissionError(false);
    try {
      if (isDemoMode) {
        navigate('/refunds/thank-you?ref=RF-DEMO-REQUEST&demo=on');
        return;
      }

      const refundCase = await submitRefundRequest({
        machineId: form.machineId,
        qrClaimToken: qrClaim?.claimToken,
        emailContextToken: emailContextToken || undefined,
        customerName: form.customerName.trim(),
        customerEmail: form.customerEmail.trim().toLowerCase(),
        customerPhone: form.customerPhone.trim(),
        zellePaymentContact:
          form.paymentMethod === 'cash' ? form.zellePaymentContact.trim() : undefined,
        issueSummary: form.issueSummary.trim(),
        incidentDate: form.incidentDate,
        incidentTime: form.incidentTime,
        paymentMethod: form.paymentMethod,
        paymentAmount: form.paymentAmount.trim(),
        cardLast4: form.paymentMethod === 'card' ? form.cardLast4.trim() : undefined,
        cardWalletUsed: form.cardWalletUsed,
        attachments: [],
      });

      setForm(emptyForm);
      navigate(`/refunds/thank-you?ref=${encodeURIComponent(refundCase?.publicReference ?? '')}`);
    } catch (error) {
      if (
        hasQrCode &&
        isEdgeFunctionError(error) &&
        ['refund_qr_unavailable', 'refund_qr_claim_used'].includes(
          String(error.data?.errorCode ?? '')
        )
      ) {
        setQrSubmissionError(true);
      }
      const message = error instanceof Error ? error.message : 'Unable to submit refund request.';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Layout>
      <section className="section-padding bg-gradient-to-b from-pink-50 via-background to-background">
        <div className="container-page">
          <div className="mx-auto max-w-3xl">
            <div className="mb-6 rounded-2xl border border-pink-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="inline-flex items-center gap-2 rounded-full bg-pink-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">
                <Sparkles className="h-3.5 w-3.5" />
                Bloomjoy Sweets
              </div>
              <h1 className="mt-2 font-display text-3xl font-bold text-foreground sm:text-4xl">
                Let us make this right
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                We are sorry your Bloomjoy treat did not go the way it should have. Share a few
                details below and our team will review your request with care. Most reviews are
                completed within 5 business days.
              </p>
            </div>

            {isDemoMode && (
              <div className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
                DEMO DATA - visual review only. This form uses synthetic locations and redirects
                to a demo thank-you page instead of creating a real refund case.
              </div>
            )}

            {hasNoLiveMachineOptions && (
              <div className="mb-4 rounded-md border border-pink-200 bg-pink-50 px-4 py-3 text-sm text-pink-950">
                {hasEmailContext ? (
                  <>
                    We could not load the Bloomjoy machine list right now. Please reply in the
                    same email conversation with the machine location or a description of the
                    machine, and our team will continue from there. You do not need to complete a
                    second form.
                  </>
                ) : (
                  <>
                    We are getting this new Bloomjoy refund form ready for selected machines. For
                    now, please use the{' '}
                    <a
                      href="https://forms.gle/qQDt2V7dFBFPqjyW6"
                      className="font-semibold underline underline-offset-2"
                    >
                      current customer service form
                    </a>{' '}
                    and our team will review your request with care.
                  </>
                )}
              </div>
            )}

            {hasQrCode && isLoadingQrClaim && (
              <div
                className="mb-4 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-4 text-sm text-foreground shadow-sm"
                role="status"
              >
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <div>
                  <p className="font-semibold">Confirming this machine</p>
                  <p className="mt-0.5 text-muted-foreground">
                    We are securely recording where and when you opened the refund form.
                  </p>
                </div>
              </div>
            )}

            {hasQrClaimError && (
              <div
                className="mb-4 rounded-lg border border-pink-200 bg-pink-50 px-4 py-4 text-sm text-pink-950"
                role="alert"
              >
                <p className="font-semibold">This machine's refund code is not available.</p>
                {hasEmailContext ? (
                  <p className="mt-1 leading-6">
                    Please reply in the same email conversation with the machine location or a
                    description of the machine. You do not need to open another form.
                  </p>
                ) : (
                  <>
                    <p className="mt-1 leading-6">
                      The code may have been replaced or disabled. You can still submit a request
                      using the regular form and choose the machine yourself.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <Button asChild size="sm">
                        <Link to="/refunds/request">Use regular refund form</Link>
                      </Button>
                      <a
                        href="https://forms.gle/qQDt2V7dFBFPqjyW6"
                        className="inline-flex min-h-9 items-center font-semibold underline underline-offset-2"
                      >
                        Open current customer service form
                      </a>
                    </div>
                  </>
                )}
              </div>
            )}

            {qrSubmissionError && (
              <div
                className="mb-4 rounded-lg border border-pink-200 bg-pink-50 px-4 py-4 text-sm text-pink-950"
                role="alert"
              >
                <p className="font-semibold">This QR session needs to be restarted.</p>
                {hasEmailContext ? (
                  <p className="mt-1 leading-6">
                    Please reply in the same email conversation so our team can continue without
                    creating a second request.
                  </p>
                ) : (
                  <>
                    <p className="mt-1 leading-6">
                      Your form is still here. Start a new QR session, then submit it again. You can
                      also switch to the regular form.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <Button type="button" size="sm" onClick={() => window.location.reload()}>
                        Start new QR session
                      </Button>
                      <Button asChild type="button" size="sm" variant="outline">
                        <Link to="/refunds/request">Use regular refund form</Link>
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            {canShowForm && (
              <form
                onSubmit={handleSubmit}
                className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6"
              >
                <div className="grid gap-5">
                  {qrClaim ? (
                    <div className="rounded-lg border border-pink-200 bg-pink-50 px-4 py-4 text-pink-950">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 rounded-full bg-white p-2 text-pink-700 shadow-sm">
                          <MapPin className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold">Machine confirmed</p>
                            <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs font-semibold text-pink-800">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              QR verified
                            </span>
                          </div>
                          <p className="mt-1 text-sm leading-6">
                            {formatMachineOption(
                              qrClaim.machine.locationName,
                              qrClaim.machine.machineLabel
                            )}
                          </p>
                          <p className="mt-2 flex items-start gap-2 text-xs leading-5 text-pink-900">
                            <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>
                              We saved the server time as{' '}
                              <strong>
                                {formatQrOpenedTime(
                                  qrClaim.openedAt,
                                  qrClaim.machine.locationTimezone
                                )}
                              </strong>
                              . You will still enter the approximate purchase time below.
                            </span>
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Label htmlFor="machine">Machine location</Label>
                      <select
                        id="machine"
                        value={form.machineId}
                        onChange={(event) => updateForm('machineId', event.target.value)}
                        required
                        disabled={isLoadingMachines || hasNoLiveMachineOptions}
                        className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="">
                          {isLoadingMachines
                            ? 'Loading locations...'
                            : hasNoLiveMachineOptions
                              ? 'Refund form is not open yet'
                              : 'Choose a location'}
                        </option>
                        {machines.map((machine) => (
                          <option key={machine.machineId} value={machine.machineId}>
                            {formatMachineOption(machine.locationName, machine.machineLabel)}
                          </option>
                        ))}
                      </select>
                      {machineError && (
                        <p className="mt-2 text-sm text-destructive">
                          Unable to load locations. Please try again shortly.
                        </p>
                      )}
                    </div>
                  )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="customer-name">Name</Label>
                    <Input
                      id="customer-name"
                      value={form.customerName}
                      onChange={(event) => updateForm('customerName', event.target.value)}
                      autoComplete="name"
                      required
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label htmlFor="customer-email">Email</Label>
                    <Input
                      id="customer-email"
                      type="email"
                      value={form.customerEmail}
                      onChange={(event) => updateForm('customerEmail', event.target.value)}
                      autoComplete="email"
                      required
                      className="mt-2"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-[1fr_160px_160px]">
                  <div>
                    <Label htmlFor="customer-phone">Phone</Label>
                    <Input
                      id="customer-phone"
                      value={form.customerPhone}
                      onChange={(event) => updateForm('customerPhone', event.target.value)}
                      autoComplete="tel"
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label htmlFor="incident-date">Incident date</Label>
                    <Input
                      id="incident-date"
                      type="date"
                      value={form.incidentDate}
                      onChange={(event) => updateForm('incidentDate', event.target.value)}
                      required
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label htmlFor="incident-time">Time</Label>
                    <Input
                      id="incident-time"
                      type="time"
                      value={form.incidentTime}
                      onChange={(event) => updateForm('incidentTime', event.target.value)}
                      required
                      className="mt-2"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-[190px_1fr]">
                  <div>
                    <Label htmlFor="payment-method">Payment method</Label>
                    <select
                      id="payment-method"
                      value={form.paymentMethod}
                      onChange={(event) =>
                        updateForm('paymentMethod', event.target.value as RefundPaymentMethod)
                      }
                      className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="card">Credit card</option>
                      <option value="cash">Cash</option>
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="payment-amount">Amount</Label>
                    <Input
                      id="payment-amount"
                      inputMode="decimal"
                      placeholder="Example: 12.00"
                      value={form.paymentAmount}
                      onChange={(event) => updateForm('paymentAmount', event.target.value)}
                      required
                      className="mt-2"
                    />
                  </div>
                </div>

                {form.paymentMethod === 'card' && (
                  <div className="rounded-lg border border-pink-200 bg-pink-50 p-4 text-sm text-pink-950">
                    <div className="grid gap-4">
                      <label className="flex min-h-11 items-start gap-3 rounded-md bg-white px-3 py-3 text-sm shadow-sm">
                        <input
                          type="checkbox"
                          checked={form.cardWalletUsed}
                          onChange={(event) => updateForm('cardWalletUsed', event.target.checked)}
                          className="mt-0.5 h-5 w-5 rounded border-input"
                        />
                        <span>
                          I tapped with Apple Pay, Google Pay, or another mobile wallet.
                        </span>
                      </label>
                      <div>
                        <Label htmlFor="card-last4">
                          {form.cardWalletUsed
                            ? 'Virtual last 4 shown in your wallet'
                            : 'Last 4 digits on the card you used'}
                        </Label>
                        <Input
                          id="card-last4"
                          aria-describedby="card-last4-guidance"
                          inputMode="numeric"
                          maxLength={4}
                          value={form.cardLast4}
                          onChange={(event) =>
                            updateForm('cardLast4', event.target.value.replace(/\D/g, '').slice(0, 4))
                          }
                          required
                          className="mt-2 bg-white"
                        />
                        <p id="card-last4-guidance" className="mt-2 leading-6 text-pink-900">
                          {form.cardWalletUsed
                            ? 'Open your wallet, select the card, and use the virtual or device card number shown there. Do not use the last 4 printed on the physical card.'
                            : 'Enter only the last 4 digits. Never send the full card number.'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {form.paymentMethod === 'cash' && (
                  <div className="rounded-lg border border-pink-200 bg-pink-50 p-4 text-sm text-pink-950">
                    <p className="leading-6">
                      For cash refunds, approved refunds are sent through Zelle. Please enter the
                      phone number or email connected to your Zelle account.
                    </p>
                    <div className="mt-4">
                      <Label htmlFor="zelle-payment-contact">Zelle phone number or email</Label>
                      <Input
                        id="zelle-payment-contact"
                        value={form.zellePaymentContact}
                        onChange={(event) => updateForm('zellePaymentContact', event.target.value)}
                        autoComplete="email"
                        required
                        className="mt-2 bg-white"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <Label htmlFor="issue-summary">What happened?</Label>
                  <Textarea
                    id="issue-summary"
                    value={form.issueSummary}
                    onChange={(event) => updateForm('issueSummary', event.target.value)}
                    required
                    rows={6}
                    placeholder="Tell us what went wrong, whether cotton candy was dispensed, and anything visible on the machine screen. We appreciate the detail."
                    className="mt-2"
                  />
                </div>

                  <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-2 text-sm text-muted-foreground">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>
                        {selectedMachine
                          ? qrClaim
                            ? `QR confirmed: ${formatMachineOption(selectedMachine.locationName, selectedMachine.machineLabel)}`
                            : `Selected: ${formatMachineOption(selectedMachine.locationName, selectedMachine.machineLabel)}`
                          : 'Your request goes to the Bloomjoy operations team.'}
                      </span>
                    </div>
                    <Button
                      type="submit"
                      disabled={
                        isSubmitting || isLoadingMachineContext || hasNoLiveMachineOptions
                      }
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Submitting...
                        </>
                      ) : (
                        'Submit Request'
                      )}
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>
    </Layout>
  );
}

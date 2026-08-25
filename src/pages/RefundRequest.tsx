import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Loader2, MapPin, ShieldCheck, Sparkles } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { isEdgeFunctionError } from '@/lib/edgeFunctions';
import {
  fetchRefundMachineOptions,
  buildLocalRefundMachineOptions,
  buildLocalRefundPublicSelections,
  isLocalUatDemoForced,
  startRefundQrClaim,
  submitRefundRequest,
  type RefundCardNetwork,
  type RefundIncidentTimeConfidence,
  type RefundIssueCategory,
  type RefundPaymentInteraction,
  type RefundPaymentMethod,
  type RefundQrClaim,
  type RefundWalletProvider,
} from '@/lib/refundOperations';

const emptyForm = {
  selectionKey: '',
  cashMachineId: '',
  customerName: '',
  customerEmail: '',
  customerPhone: '',
  incidentDate: '',
  incidentTime: '',
  paymentAmount: '',
  paymentMethod: 'card' as RefundPaymentMethod,
  cardLast4: '',
  cardNetwork: '' as RefundCardNetwork | '',
  cardWalletUsed: false,
  paymentInteraction: '' as RefundPaymentInteraction | '',
  walletProvider: '' as RefundWalletProvider | '',
  incidentTimeConfidence: '' as RefundIncidentTimeConfidence | '',
  issueCategory: '' as RefundIssueCategory | '',
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
        ? [{
            selectionKey: qrClaim.machine.machineId,
            displayLabel: formatMachineOption(
              qrClaim.machine.locationName,
              qrClaim.machine.machineLabel
            ),
            selectionKind: 'exact_machine' as const,
            machineId: qrClaim.machine.machineId,
            locationTimezone: qrClaim.machine.locationTimezone,
          }]
        : isDemoMode
          ? buildLocalRefundPublicSelections()
          : liveMachines,
    [isDemoMode, liveMachines, qrClaim]
  );
  const hasAvailableMachines = machines.length > 0;
  const hasNoLiveMachineOptions =
    !hasQrCode &&
    !isDemoMode &&
    !isLoadingMachines &&
    (Boolean(machineError) || !hasAvailableMachines);
  const isLoadingMachineContext = hasQrCode ? isLoadingQrClaim : isLoadingMachines;
  const hasQrClaimError = hasQrCode && !isLoadingQrClaim && Boolean(qrClaimError);
  const canShowForm = !hasQrCode || Boolean(qrClaim);

  useEffect(() => {
    if (!qrClaim) return;

    setForm((current) => {
      if (current.selectionKey === qrClaim.machine.machineId) return current;
      return { ...current, selectionKey: qrClaim.machine.machineId };
    });
  }, [qrClaim]);

  const selectedMachine = useMemo(
    () => machines.find((machine) => machine.selectionKey === form.selectionKey) ?? null,
    [form.selectionKey, machines]
  );

  const updateForm = (key: keyof typeof form, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const updatePaymentMethod = (paymentMethod: RefundPaymentMethod) => {
    setForm((current) => ({
      ...current,
      paymentMethod,
      cashMachineId: '',
      cardLast4: '',
      cardNetwork: '',
      cardWalletUsed: false,
      paymentInteraction: paymentMethod === 'cash' ? 'cash' : '',
      walletProvider: '',
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // Native date/time controls can be populated by browser autofill without
    // dispatching the event React uses to update controlled state. Read the
    // submitted controls so the values customers can see are the values we
    // validate and send.
    const submittedFields = new FormData(event.currentTarget);
    const incidentDate = String(
      submittedFields.get('incidentDate') ?? form.incidentDate
    ).trim();
    const incidentTime = String(
      submittedFields.get('incidentTime') ?? form.incidentTime
    ).trim();

    if (hasNoLiveMachineOptions) {
      toast.error('This refund form is not open for customer submissions yet.');
      return;
    }

    if (hasQrCode && !qrClaim) {
      toast.error('Scan the machine refund code again or use the regular refund form.');
      return;
    }

    if (!form.selectionKey) {
      toast.error('Choose the machine location so we can route your request.');
      return;
    }

    if (!hasValidIncidentLocalTime(incidentDate, incidentTime)) {
      toast.error('Enter the date and time when the issue happened.');
      return;
    }

    if (!form.incidentTimeConfidence) {
      toast.error('Tell us how accurate the purchase time is.');
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

    if (
      form.paymentMethod === 'cash' &&
      selectedMachine?.selectionKind === 'livermore_pair' &&
      !form.cashMachineId
    ) {
      toast.error('Choose the cash machine you used.');
      return;
    }

    if (form.paymentMethod === 'card' && !/^[0-9]{4}$/.test(form.cardLast4.trim())) {
      toast.error('Enter the last 4 digits shown for the card payment.');
      return;
    }

    if (form.paymentMethod === 'card' && !form.paymentInteraction) {
      toast.error('Tell us how you paid at the machine.');
      return;
    }

    if (
      form.paymentMethod === 'card' &&
      form.paymentInteraction === 'phone_watch_wallet' &&
      !form.walletProvider
    ) {
      toast.error('Choose the phone or watch wallet you used.');
      return;
    }

    if (
      form.paymentMethod === 'card' &&
      ['phone_watch_wallet', 'tap_card', 'insert_or_swipe'].includes(form.paymentInteraction) &&
      !form.cardNetwork
    ) {
      toast.error('Choose the card type shown on your card or in your wallet.');
      return;
    }

    if (!form.issueCategory) {
      toast.error('Choose the option that best describes what happened.');
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
        selectionKey:
          qrClaim ||
          selectedMachine?.selectionKind === 'legacy_exact_machine' ||
          (form.paymentMethod === 'cash' && selectedMachine?.selectionKind === 'livermore_pair')
            ? undefined
            : form.selectionKey,
        machineId:
          qrClaim?.machine.machineId ??
          (form.paymentMethod === 'cash' && selectedMachine?.selectionKind === 'livermore_pair'
            ? form.cashMachineId
            : selectedMachine?.selectionKind === 'legacy_exact_machine'
              ? selectedMachine.machineId
              : undefined),
        qrClaimToken: qrClaim?.claimToken,
        emailContextToken: emailContextToken || undefined,
        customerName: form.customerName.trim(),
        customerEmail: form.customerEmail.trim().toLowerCase(),
        customerPhone: form.customerPhone.trim(),
        issueSummary: form.issueSummary.trim(),
        incidentDate,
        incidentTime,
        paymentMethod: form.paymentMethod,
        paymentAmount: form.paymentAmount.trim(),
        cardLast4: form.paymentMethod === 'card' ? form.cardLast4.trim() : undefined,
        cardNetwork:
          form.paymentMethod === 'card' && form.cardNetwork ? form.cardNetwork : undefined,
        cardWalletUsed: form.paymentMethod === 'card' ? form.cardWalletUsed : undefined,
        paymentInteraction:
          form.paymentMethod === 'cash' ? 'cash' : form.paymentInteraction || 'unsure',
        walletProvider:
          form.paymentMethod === 'card' &&
          form.paymentInteraction === 'phone_watch_wallet' &&
          form.walletProvider
            ? form.walletProvider
            : undefined,
        incidentTimeConfidence: form.incidentTimeConfidence || 'rough',
        issueCategory: form.issueCategory || 'other',
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
                Request a refund
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                Tell us about one purchase. Most requests are reviewed within 5 business days.
                We will email you if we need anything else.
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
                    We could not load the Bloomjoy machine list right now. Please try this page
                    again shortly. If it still does not load,{' '}
                    <a
                      href="mailto:info@bloomjoysweets.com?subject=Bloomjoy%20refund%20form%20help"
                      className="font-semibold underline underline-offset-2"
                    >
                      email Bloomjoy customer service
                    </a>
                    . We will help you return to this Bloomjoy form. Sending an email does not
                    submit a refund request.
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
                        href="mailto:info@bloomjoysweets.com?subject=Bloomjoy%20refund%20form%20help"
                        className="inline-flex min-h-9 items-center font-semibold underline underline-offset-2"
                      >
                        Email Bloomjoy customer service
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
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">Purchase</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Where and when did you make the purchase?</p>
                  </div>
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
                        value={form.selectionKey}
                        onChange={(event) => updateForm('selectionKey', event.target.value)}
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
                          <option key={machine.selectionKey} value={machine.selectionKey}>
                            {machine.displayLabel}
                          </option>
                        ))}
                      </select>
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

                <div className="grid gap-4 sm:grid-cols-[1fr_150px_150px]">
                  <div>
                    <Label htmlFor="customer-phone">Phone (optional)</Label>
                    <Input
                      id="customer-phone"
                      value={form.customerPhone}
                      onChange={(event) => updateForm('customerPhone', event.target.value)}
                      autoComplete="tel"
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label htmlFor="incident-date">Purchase date</Label>
                    <Input
                      id="incident-date"
                      name="incidentDate"
                      type="date"
                      value={form.incidentDate}
                      onChange={(event) => updateForm('incidentDate', event.target.value)}
                      required
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label htmlFor="incident-time">Approximate purchase time</Label>
                    <Input
                      id="incident-time"
                      name="incidentTime"
                      type="time"
                      value={form.incidentTime}
                      onChange={(event) => updateForm('incidentTime', event.target.value)}
                      required
                      className="mt-2"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="incident-time-confidence">How close is that time?</Label>
                  <select
                    id="incident-time-confidence"
                    value={form.incidentTimeConfidence}
                    onChange={(event) =>
                      updateForm(
                        'incidentTimeConfidence',
                        event.target.value as RefundIncidentTimeConfidence
                      )
                    }
                    required
                    className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Choose one</option>
                    <option value="exact">Exact or within a few minutes</option>
                    <option value="within_15_minutes">Within about 15 minutes</option>
                    <option value="within_1_hour">Within about 1 hour</option>
                    <option value="rough">Just a rough estimate</option>
                  </select>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    This helps us avoid matching the wrong purchase.
                  </p>
                </div>

                <div className="border-t border-border pt-5">
                  <h2 className="text-lg font-semibold text-foreground">Payment</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Share only the limited payment details below.</p>
                </div>

                <fieldset>
                  <legend className="text-sm font-medium leading-none">How did you pay?</legend>
                  <RadioGroup
                    name="paymentMethod"
                    value={form.paymentMethod}
                    onValueChange={(value) => updatePaymentMethod(value as RefundPaymentMethod)}
                    required
                    className="mt-3 grid gap-3 sm:grid-cols-2"
                  >
                    <Label
                      htmlFor="payment-method-card"
                      className="flex min-h-16 cursor-pointer items-center gap-3 rounded-lg border border-input bg-white px-4 py-3 font-normal transition-colors has-[[data-state=checked]]:border-pink-500 has-[[data-state=checked]]:bg-pink-50"
                    >
                      <RadioGroupItem id="payment-method-card" value="card" />
                      <span>
                        <span className="block font-semibold text-foreground">Card</span>
                        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                          We will use limited card details to find the purchase.
                        </span>
                      </span>
                    </Label>
                    <Label
                      htmlFor="payment-method-cash"
                      className="flex min-h-16 cursor-pointer items-center gap-3 rounded-lg border border-input bg-white px-4 py-3 font-normal transition-colors has-[[data-state=checked]]:border-pink-500 has-[[data-state=checked]]:bg-pink-50"
                    >
                      <RadioGroupItem id="payment-method-cash" value="cash" />
                      <span>
                        <span className="block font-semibold text-foreground">Cash</span>
                        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                          No card details are needed.
                        </span>
                      </span>
                    </Label>
                  </RadioGroup>
                </fieldset>

                <div>
                  <Label htmlFor="payment-amount">Amount paid</Label>
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

                {form.paymentMethod === 'cash' &&
                  selectedMachine?.selectionKind === 'livermore_pair' && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                      <Label htmlFor="cash-machine">Which machine did you use?</Label>
                      <select
                        id="cash-machine"
                        value={form.cashMachineId}
                        onChange={(event) => updateForm('cashMachineId', event.target.value)}
                        required
                        className="mt-2 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                      >
                        <option value="">Choose the machine label</option>
                        {(selectedMachine.cashMachineOptions ?? []).map((machine) => (
                          <option key={machine.machineId} value={machine.machineId}>
                            {machine.displayLabel}
                          </option>
                        ))}
                      </select>
                      <p className="mt-2 text-xs leading-5 text-amber-900">
                        Look for the small TT label on the machine.
                      </p>
                    </div>
                  )}

                {form.paymentMethod === 'card' && (
                  <div className="rounded-lg border border-pink-200 bg-pink-50 p-4 text-sm text-pink-950">
                  <div className="grid gap-4">
                      <div>
                        <Label htmlFor="payment-interaction">How did you pay at the machine?</Label>
                        <select
                          id="payment-interaction"
                          value={form.paymentInteraction}
                          onChange={(event) => {
                            const paymentInteraction = event.target.value as RefundPaymentInteraction;
                            setForm((current) => ({
                              ...current,
                              paymentInteraction,
                              cardWalletUsed: paymentInteraction === 'phone_watch_wallet',
                              walletProvider:
                                paymentInteraction === 'phone_watch_wallet' ? current.walletProvider : '',
                              cardNetwork:
                                paymentInteraction === 'unsure' ? '' : current.cardNetwork,
                            }));
                          }}
                          required
                          className="mt-2 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                        >
                          <option value="">Choose one</option>
                          <option value="phone_watch_wallet">Tapped a phone or watch wallet</option>
                          <option value="tap_card">Tapped a physical card</option>
                          <option value="insert_or_swipe">Inserted or swiped a physical card</option>
                          <option value="unsure">I am not sure</option>
                        </select>
                      </div>
                      {form.paymentInteraction === 'phone_watch_wallet' && (
                        <div>
                          <Label htmlFor="wallet-provider">Which wallet did you use?</Label>
                          <select
                            id="wallet-provider"
                            value={form.walletProvider}
                            onChange={(event) =>
                              updateForm('walletProvider', event.target.value as RefundWalletProvider)
                            }
                            required
                            className="mt-2 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                          >
                            <option value="">Choose one</option>
                            <option value="apple_pay">Apple Pay</option>
                            <option value="google_wallet">Google Wallet</option>
                            <option value="other">Another wallet</option>
                            <option value="unsure">I am not sure</option>
                          </select>
                        </div>
                      )}
                      {['phone_watch_wallet', 'tap_card', 'insert_or_swipe'].includes(
                        form.paymentInteraction
                      ) && (
                        <div>
                          <Label htmlFor="card-network">Card type</Label>
                          <select
                            id="card-network"
                            aria-describedby="card-network-guidance"
                            value={form.cardNetwork}
                            onChange={(event) =>
                              updateForm('cardNetwork', event.target.value as RefundCardNetwork)
                            }
                            required
                            className="mt-2 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                          >
                            <option value="">Choose one</option>
                            <option value="visa">Visa</option>
                            <option value="mastercard">Mastercard</option>
                            <option value="discover">Discover</option>
                            <option value="american_express">American Express</option>
                            <option value="other_unknown">Other / Not sure</option>
                          </select>
                          <p id="card-network-guidance" className="mt-2 leading-6 text-pink-900">
                            Use the logo on the physical card or the card shown inside your mobile
                            wallet. Never send a full card number, expiration date, security code,
                            wallet password, or card screenshot.
                          </p>
                        </div>
                      )}
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

                <div className="border-t border-border pt-5">
                  <h2 className="text-lg font-semibold text-foreground">What happened</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Tell us what went wrong with the purchase.</p>
                </div>

                <div>
                  <Label htmlFor="issue-category">What best describes the problem?</Label>
                  <select
                    id="issue-category"
                    value={form.issueCategory}
                    onChange={(event) =>
                      updateForm('issueCategory', event.target.value as RefundIssueCategory)
                    }
                    required
                    className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Choose one</option>
                    <option value="charged_no_product">
                      {form.paymentMethod === 'cash'
                        ? 'Paid, but no product came out'
                        : 'Charged, but no product came out'}
                    </option>
                    <option value="product_problem">The product came out incorrectly</option>
                    <option value="charged_more_than_once">
                      {form.paymentMethod === 'cash' ? 'Paid more than once' : 'Charged more than once'}
                    </option>
                    <option value="wrong_amount">
                      {form.paymentMethod === 'cash' ? 'Machine took the wrong amount' : 'Charged the wrong amount'}
                    </option>
                    <option value="other">Something else</option>
                  </select>
                </div>

                <div>
                  <Label htmlFor="issue-summary">What happened?</Label>
                  <Textarea
                    id="issue-summary"
                    value={form.issueSummary}
                    onChange={(event) => updateForm('issueSummary', event.target.value)}
                    required
                    rows={6}
                    placeholder="Tell us what went wrong, whether anything was dispensed, and anything visible on the machine screen. We appreciate the detail."
                    className="mt-2"
                  />
                </div>

                  <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-2 text-sm text-muted-foreground">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>
                        {selectedMachine
                          ? qrClaim
                            ? `QR confirmed: ${selectedMachine.displayLabel}`
                            : `Selected: ${selectedMachine.displayLabel}`
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
                          Sending your request...
                        </>
                      ) : (
                        'Send refund request'
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

import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
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

type RefundRequiredField =
  | 'selectionKey'
  | 'customerEmail'
  | 'incidentDate'
  | 'incidentTime'
  | 'paymentAmount'
  | 'cashMachineId'
  | 'cardLast4'
  | 'issueCategory';

const fieldElementId: Record<RefundRequiredField, string> = {
  selectionKey: 'machine',
  customerEmail: 'customer-email',
  incidentDate: 'incident-date',
  incidentTime: 'incident-time',
  paymentAmount: 'payment-amount',
  cashMachineId: 'cash-machine',
  cardLast4: 'card-last4',
  issueCategory: 'issue-category',
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
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RefundRequiredField, string>>>({});
  const formRef = useRef<HTMLFormElement>(null);
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
    if (Object.prototype.hasOwnProperty.call(fieldElementId, key)) {
      const requiredKey = key as RefundRequiredField;
      setFieldErrors((current) => ({ ...current, [requiredKey]: undefined }));
    }
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

    const errors: Partial<Record<RefundRequiredField, string>> = {};
    if (!form.selectionKey) errors.selectionKey = 'Choose the Bloomjoy machine you used.';
    if (!/^\S+@\S+\.\S+$/.test(form.customerEmail.trim())) {
      errors.customerEmail = 'Enter a valid email address.';
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(incidentDate)) {
      errors.incidentDate = 'Enter the purchase date.';
    }
    if (!/^\d{2}:\d{2}$/.test(incidentTime)) {
      errors.incidentTime = 'Enter the approximate purchase time.';
    }
    if (!form.paymentAmount.trim() || Number(form.paymentAmount) <= 0) {
      errors.paymentAmount = 'Enter the amount you paid.';
    }
    if (
      form.paymentMethod === 'cash' &&
      selectedMachine?.selectionKind === 'livermore_pair' &&
      !form.cashMachineId
    ) errors.cashMachineId = 'Choose the cash machine you used.';
    if (form.paymentMethod === 'card' && !/^[0-9]{4}$/.test(form.cardLast4.trim())) {
      errors.cardLast4 = 'Enter only the last 4 digits shown for this payment.';
    }
    if (!form.issueCategory) {
      errors.issueCategory = 'Choose the option that best describes the problem.';
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const firstField = Object.keys(errors)[0] as RefundRequiredField;
      requestAnimationFrame(() => {
        const field = formRef.current?.querySelector<HTMLElement>(
          `#${fieldElementId[firstField]}`,
        );
        field?.focus();
      });
      toast.error('Please check the highlighted fields.');
      return;
    }
    if (!hasValidIncidentLocalTime(incidentDate, incidentTime)) return;

    setIsSubmitting(true);
    setQrSubmissionError(false);
    try {
      if (isDemoMode) {
        navigate('/refunds/thank-you?demo=on', {
          state: { reference: 'RF-DEMO-REQUEST', statusToken: null },
        });
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
      navigate('/refunds/thank-you', {
        state: {
          reference: refundCase.publicReference,
          statusToken: refundCase.statusToken,
          statusExpiresAt: refundCase.statusExpiresAt,
        },
      });
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
                ref={formRef}
                noValidate
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
                        aria-invalid={Boolean(fieldErrors.selectionKey)}
                        aria-describedby={fieldErrors.selectionKey ? 'machine-error' : undefined}
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
                      {fieldErrors.selectionKey && (
                        <p id="machine-error" className="mt-1.5 text-sm text-destructive" role="alert">
                          {fieldErrors.selectionKey}
                        </p>
                      )}
                    </div>
                  )}

                <div>
                  <Label htmlFor="customer-email">Email</Label>
                  <Input
                    id="customer-email"
                    type="email"
                    value={form.customerEmail}
                    onChange={(event) => updateForm('customerEmail', event.target.value)}
                    autoComplete="email"
                    aria-invalid={Boolean(fieldErrors.customerEmail)}
                    aria-describedby={fieldErrors.customerEmail ? 'customer-email-error' : undefined}
                    className="mt-2 h-11"
                  />
                  {fieldErrors.customerEmail && (
                    <p id="customer-email-error" className="mt-1.5 text-sm text-destructive" role="alert">
                      {fieldErrors.customerEmail}
                    </p>
                  )}
                  <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                    We use this only for this request and its secure status link.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="incident-date">Purchase date</Label>
                    <Input
                      id="incident-date"
                      name="incidentDate"
                      type="date"
                      value={form.incidentDate}
                      onChange={(event) => updateForm('incidentDate', event.target.value)}
                      aria-invalid={Boolean(fieldErrors.incidentDate)}
                      aria-describedby={fieldErrors.incidentDate ? 'incident-date-error' : undefined}
                      className="mt-2 h-11"
                    />
                    {fieldErrors.incidentDate && (
                      <p id="incident-date-error" className="mt-1.5 text-sm text-destructive" role="alert">
                        {fieldErrors.incidentDate}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="incident-time">Approximate purchase time</Label>
                    <Input
                      id="incident-time"
                      name="incidentTime"
                      type="time"
                      value={form.incidentTime}
                      onChange={(event) => updateForm('incidentTime', event.target.value)}
                      aria-invalid={Boolean(fieldErrors.incidentTime)}
                      aria-describedby={fieldErrors.incidentTime ? 'incident-time-error' : undefined}
                      className="mt-2 h-11"
                    />
                    {fieldErrors.incidentTime && (
                      <p id="incident-time-error" className="mt-1.5 text-sm text-destructive" role="alert">
                        {fieldErrors.incidentTime}
                      </p>
                    )}
                  </div>
                </div>

                <section
                  data-testid="refund-payment-section"
                  className="space-y-4 border-t border-border pt-5"
                >
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">Payment</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Share only the limited payment details below.
                    </p>
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
                    aria-invalid={Boolean(fieldErrors.paymentAmount)}
                    aria-describedby={fieldErrors.paymentAmount ? 'payment-amount-error' : undefined}
                    className="mt-2 h-11"
                  />
                  {fieldErrors.paymentAmount && (
                    <p id="payment-amount-error" className="mt-1.5 text-sm text-destructive" role="alert">
                      {fieldErrors.paymentAmount}
                    </p>
                  )}
                </div>

                {form.paymentMethod === 'cash' &&
                  selectedMachine?.selectionKind === 'livermore_pair' && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                      <Label htmlFor="cash-machine">Which machine did you use?</Label>
                      <select
                        id="cash-machine"
                        value={form.cashMachineId}
                        onChange={(event) => updateForm('cashMachineId', event.target.value)}
                        aria-invalid={Boolean(fieldErrors.cashMachineId)}
                        aria-describedby={fieldErrors.cashMachineId ? 'cash-machine-error' : undefined}
                        className="mt-2 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                      >
                        <option value="">Choose the machine label</option>
                        {(selectedMachine.cashMachineOptions ?? []).map((machine) => (
                          <option key={machine.machineId} value={machine.machineId}>
                            {machine.displayLabel}
                          </option>
                        ))}
                      </select>
                      {fieldErrors.cashMachineId && (
                        <p id="cash-machine-error" className="mt-1.5 text-sm text-destructive" role="alert">
                          {fieldErrors.cashMachineId}
                        </p>
                      )}
                      <p className="mt-2 text-xs leading-5 text-amber-900">
                        Look for the small TT label on the machine.
                      </p>
                    </div>
                  )}

                {form.paymentMethod === 'card' && (
                  <div className="rounded-lg border border-pink-200 bg-pink-50 p-4 text-sm text-pink-950">
                    <div>
                      <Label htmlFor="card-last4">
                        {form.cardWalletUsed
                          ? 'Virtual last 4 shown in your wallet'
                          : 'Last 4 digits shown for this payment'}
                      </Label>
                      <Input
                        id="card-last4"
                        aria-invalid={Boolean(fieldErrors.cardLast4)}
                        aria-describedby={fieldErrors.cardLast4 ? 'card-last4-error card-last4-guidance' : 'card-last4-guidance'}
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={4}
                        value={form.cardLast4}
                        onChange={(event) =>
                          updateForm('cardLast4', event.target.value.replace(/\D/g, '').slice(0, 4))
                        }
                        className="mt-2 h-11 bg-white text-lg tracking-[0.2em]"
                      />
                      {fieldErrors.cardLast4 && (
                        <p id="card-last4-error" className="mt-1.5 text-sm text-destructive" role="alert">
                          {fieldErrors.cardLast4}
                        </p>
                      )}
                      <p id="card-last4-guidance" className="mt-2 leading-6 text-pink-900">
                        {form.cardWalletUsed
                          ? 'Use the virtual last 4 shown for this wallet payment. Do not use the last 4 printed on the physical card.'
                          : 'Enter only 4 digits—never a full card number, security code, or screenshot.'}
                      </p>
                    </div>
                    <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-pink-200 bg-white px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={form.cardWalletUsed}
                        onChange={(event) => {
                          const usedWallet = event.target.checked;
                          setForm((current) => ({
                            ...current,
                            cardWalletUsed: usedWallet,
                            paymentInteraction: usedWallet ? 'phone_watch_wallet' : '',
                            walletProvider: usedWallet ? current.walletProvider : '',
                          }));
                        }}
                        className="h-4 w-4 rounded border-input accent-pink-600"
                      />
                      <span>I used Apple Pay or another phone/watch wallet</span>
                    </label>
                    {form.cardWalletUsed && (
                      <div className="mt-4">
                        <Label htmlFor="wallet-provider">Wallet (optional)</Label>
                        <select
                          id="wallet-provider"
                          value={form.walletProvider}
                          onChange={(event) =>
                            updateForm('walletProvider', event.target.value as RefundWalletProvider)
                          }
                          className="mt-2 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                        >
                          <option value="">Choose if known</option>
                          <option value="apple_pay">Apple Pay</option>
                          <option value="google_wallet">Google Wallet</option>
                          <option value="other">Another wallet</option>
                          <option value="unsure">I am not sure</option>
                        </select>
                      </div>
                    )}
                  </div>
                )}
                </section>

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
                    aria-invalid={Boolean(fieldErrors.issueCategory)}
                    aria-describedby={fieldErrors.issueCategory ? 'issue-category-error' : undefined}
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
                  {fieldErrors.issueCategory && (
                    <p id="issue-category-error" className="mt-1.5 text-sm text-destructive" role="alert">
                      {fieldErrors.issueCategory}
                    </p>
                  )}
                </div>

                <details className="rounded-xl border border-border bg-muted/20 p-4">
                  <summary className="cursor-pointer font-semibold text-foreground">
                    Add optional details
                  </summary>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    These can help with unusual purchases. You can submit a normal card request
                    without them.
                  </p>
                  <div className="mt-4 grid gap-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="customer-name">Name (optional)</Label>
                        <Input
                          id="customer-name"
                          value={form.customerName}
                          onChange={(event) => updateForm('customerName', event.target.value)}
                          autoComplete="name"
                          className="mt-2 bg-white"
                        />
                      </div>
                      <div>
                        <Label htmlFor="customer-phone">Phone (optional)</Label>
                        <Input
                          id="customer-phone"
                          value={form.customerPhone}
                          onChange={(event) => updateForm('customerPhone', event.target.value)}
                          autoComplete="tel"
                          className="mt-2 bg-white"
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="incident-time-confidence">How close is the time? (optional)</Label>
                      <select
                        id="incident-time-confidence"
                        value={form.incidentTimeConfidence}
                        onChange={(event) =>
                          updateForm(
                            'incidentTimeConfidence',
                            event.target.value as RefundIncidentTimeConfidence
                          )
                        }
                        className="mt-2 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                      >
                        <option value="">Just a rough estimate</option>
                        <option value="exact">Exact or within a few minutes</option>
                        <option value="within_15_minutes">Within about 15 minutes</option>
                        <option value="within_1_hour">Within about 1 hour</option>
                        <option value="rough">Just a rough estimate</option>
                      </select>
                    </div>

                    {form.paymentMethod === 'card' && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        {!form.cardWalletUsed && (
                          <div>
                            <Label htmlFor="payment-interaction">How did you use the card? (optional)</Label>
                            <select
                              id="payment-interaction"
                              value={form.paymentInteraction}
                              onChange={(event) =>
                                updateForm('paymentInteraction', event.target.value as RefundPaymentInteraction)
                              }
                              className="mt-2 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                            >
                              <option value="">Not sure</option>
                              <option value="tap_card">Tapped the card</option>
                              <option value="insert_or_swipe">Inserted or swiped the card</option>
                              <option value="unsure">I am not sure</option>
                            </select>
                          </div>
                        )}
                        <div>
                          <Label htmlFor="card-network">Card type (optional)</Label>
                          <select
                            id="card-network"
                            value={form.cardNetwork}
                            onChange={(event) =>
                              updateForm('cardNetwork', event.target.value as RefundCardNetwork)
                            }
                            className="mt-2 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                          >
                            <option value="">Choose if known</option>
                            <option value="visa">Visa</option>
                            <option value="mastercard">Mastercard</option>
                            <option value="discover">Discover</option>
                            <option value="american_express">American Express</option>
                            <option value="other_unknown">Other / Not sure</option>
                          </select>
                        </div>
                      </div>
                    )}

                    <div>
                      <Label htmlFor="issue-summary">Anything else? (optional)</Label>
                      <Textarea
                        id="issue-summary"
                        value={form.issueSummary}
                        onChange={(event) => updateForm('issueSummary', event.target.value)}
                        rows={4}
                        placeholder="For example, whether anything came out or what the screen showed."
                        className="mt-2 bg-white"
                      />
                    </div>
                  </div>
                </details>

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
                      className="min-h-11"
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

import { useRefundCustomerLanguage } from '@/hooks/useRefundCustomerLanguage';
import { RefundCustomerLanguageToggle } from '@/components/refunds/RefundCustomerLanguageToggle';
import { fetchRefundGiftCardOffer } from '@/lib/refundGiftCardApi';
import { type RefundResolutionMethod } from '@/lib/refundGiftCard';
import { RefundGiftCardTerms } from '@/components/refunds/RefundGiftCardTerms';
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
  clearRefundSubmissionAttempt,
  getRefundSessionStorage,
  prepareRefundSubmissionAttempt,
  storeRefundSubmissionReceipt,
  type RefundSubmissionAttempt,
} from '@/lib/refundSubmissionRecovery';
import {
  fetchRefundMachineOptions,
  buildLocalRefundMachineOptions,
  buildLocalRefundPublicSelections,
  isLocalUatDemoForced,
  startRefundQrClaim,
  submitRefundRequest,
  type RefundCardNetwork,
  type RefundCardLast4Source,
  type RefundIncidentTimeConfidence,
  type RefundIncidentTimeSource,
  type RefundIssueCategory,
  type RefundPaymentInteraction,
  type RefundPaymentMethod,
  type RefundQrClaim,
  type RefundWalletProvider,
  type RefundWalletDeviceKind,
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
  cashInsertedAmount: '',
  expectedChangeAmount: '',
  paymentMethod: 'card' as RefundPaymentMethod,
  resolutionMethod: 'gift_card' as RefundResolutionMethod,
  cardLast4: '',
  cardLast4Source: '' as RefundCardLast4Source | '',
  cardNetwork: '' as RefundCardNetwork | '',
  cardWalletUsed: false,
  paymentInteraction: '' as RefundPaymentInteraction | '',
  walletProvider: '' as RefundWalletProvider | '',
  walletDeviceKind: '' as RefundWalletDeviceKind | '',
  incidentTimeConfidence: '' as RefundIncidentTimeConfidence | '',
  incidentTimeSource: '' as RefundIncidentTimeSource | '',
  issueCategory: '' as RefundIssueCategory | '',
  issueSummary: '',
};

type RefundRequiredField =
  | 'selectionKey'
  | 'customerEmail'
  | 'incidentDate'
  | 'incidentTime'
  | 'paymentAmount'
  | 'cashInsertedAmount'
  | 'expectedChangeAmount'
  | 'cashMachineId'
  | 'cardLast4'
  | 'issueCategory';

const fieldElementId: Record<RefundRequiredField, string> = {
  selectionKey: 'machine',
  customerEmail: 'customer-email',
  incidentDate: 'incident-date',
  incidentTime: 'incident-time',
  paymentAmount: 'payment-amount',
  cashInsertedAmount: 'cash-inserted-amount',
  expectedChangeAmount: 'expected-change-amount',
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

const formatQrOpenedTime = (openedAt: string, timeZone: string, locale: 'en' | 'es') => {
  try {
    return new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
      timeZoneName: 'short',
    }).format(new Date(openedAt));
  } catch {
    return locale === 'es' ? 'la hora en que escaneó el código' : 'the time you scanned the code';
  }
};

export default function RefundRequestPage() {
  const { locale, setLocale, t } = useRefundCustomerLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState(emptyForm);
  const [giftCardAvailabilityByMachine, setGiftCardAvailabilityByMachine] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RefundRequiredField, string>>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const submissionErrorRef = useRef<HTMLDivElement>(null);
  const submissionAttemptRef = useRef<RefundSubmissionAttempt | null>(null);
  const submissionAttemptPersistedRef = useRef(false);
  const submissionLockRef = useRef(false);
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
            giftCardEnabled: qrClaim.machine.giftCardEnabled,
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

  const isCashChange = form.paymentMethod === 'cash' && form.issueCategory === 'expected_cash_change';
  const isPartialItems = form.issueCategory === 'partial_items';
  const reportedProductCost = Number(form.cashInsertedAmount) - Number(form.expectedChangeAmount);
  const paymentAmount = isCashChange && reportedProductCost > 0 ? reportedProductCost.toFixed(2) : isCashChange ? '' : form.paymentAmount;
  const offerAmount = isCashChange ? form.expectedChangeAmount : form.paymentAmount;
  const requiresManagerReview = isCashChange || isPartialItems || Math.ceil(Number(offerAmount) / 5) * 5 > 25;

  const giftCardAvailable = selectedMachine?.cashMachineOptions?.find((machine) => machine.machineId === form.cashMachineId)?.giftCardEnabled
    ?? selectedMachine?.giftCardEnabled === true;
  const choosesGiftCard = giftCardAvailable && form.resolutionMethod === 'gift_card';
  const offerMachineId = qrClaim?.machine.machineId ??
    (selectedMachine?.selectionKind === 'livermore_pair' && (form.paymentMethod === 'cash' || choosesGiftCard)
      ? form.cashMachineId : selectedMachine?.machineId);
  const offerQuery = useQuery({
    queryKey: ['refund-gift-card-offer', form.selectionKey, offerMachineId, form.paymentMethod, offerAmount, form.issueCategory],
    queryFn: () => fetchRefundGiftCardOffer({ machineId: offerMachineId || undefined,
      selectionKey: offerMachineId ? undefined : form.selectionKey,
      amount: offerAmount.trim(), paymentMethod: form.paymentMethod as 'card' | 'cash', issueCategory: form.issueCategory }),
    enabled: !isDemoMode && choosesGiftCard && Boolean(form.selectionKey) && Number(offerAmount) > 0 &&
      !((form.paymentMethod === 'cash' || choosesGiftCard) && selectedMachine?.selectionKind === 'livermore_pair' && !form.cashMachineId),
    retry: false,
    staleTime: 30000,
  });
  const giftAvailabilityKey = offerMachineId || form.selectionKey;
  useEffect(() => {
    const enabled = offerQuery.data?.giftCardEnabled;
    if (typeof enabled !== 'boolean' || !giftAvailabilityKey) return;
    setGiftCardAvailabilityByMachine((current) => current[giftAvailabilityKey] === enabled
      ? current : { ...current, [giftAvailabilityKey]: enabled });
  }, [offerQuery.data?.giftCardEnabled, giftAvailabilityKey]);
  // Only an explicit server response can preserve the pre-launch cash process.
  // Errors, stockouts and missing denominations never imply a disabled pool.
  const legacyCash = form.paymentMethod === 'cash' && (!giftCardAvailable || offerQuery.data?.giftCardEnabled === false || giftCardAvailabilityByMachine[giftAvailabilityKey] === false);
  const wantsGiftCard = choosesGiftCard && !legacyCash;
  const needsCardDetails = form.paymentMethod === 'card' && !wantsGiftCard;
  const resolutionMethod: RefundResolutionMethod = wantsGiftCard ? 'gift_card' : 'original_payment';
  const giftCardOffer = offerQuery.data?.offer ?? null;
  useEffect(() => {
    if (form.issueCategory === 'expected_cash_change' && (form.paymentMethod !== 'cash' || legacyCash)) {
      setForm((current) => ({ ...current, issueCategory: '' }));
    }
  }, [form.issueCategory, form.paymentMethod, legacyCash]);

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
      resolutionMethod: 'gift_card',
      cashMachineId: '',
      cardLast4: '',
      cardLast4Source: '',
      cardNetwork: '',
      cardWalletUsed: false,
      paymentInteraction: paymentMethod === 'cash' ? 'cash' : '',
      walletProvider: '',
      walletDeviceKind: '',
      issueCategory: current.issueCategory === 'expected_cash_change' && paymentMethod !== 'cash' ? '' : current.issueCategory,
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submissionLockRef.current) return;

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
      toast.error(t("This refund form is not open for customer submissions yet."));
      return;
    }

    if (hasQrCode && !qrClaim) {
      toast.error(t("Scan the machine refund code again or use the regular refund form."));
      return;
    }

    const errors: Partial<Record<RefundRequiredField, string>> = {};
    if (!form.selectionKey) errors.selectionKey = t("Choose the Bloomjoy machine you used.");
    if (!/^\S+@\S+\.\S+$/.test(form.customerEmail.trim())) {
      errors.customerEmail = t("Enter a valid email address.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(incidentDate)) {
      errors.incidentDate = t("Enter the purchase date.");
    }
    if (!/^\d{2}:\d{2}$/.test(incidentTime)) {
      errors.incidentTime = t("Enter the approximate purchase time.");
    }
    if (!isCashChange && (!/^\d+(?:\.\d{1,2})?$/.test(paymentAmount.trim()) || Number(paymentAmount) <= 0)) {
      errors.paymentAmount = t("Enter the amount you paid.");
    }
    if (
      (form.paymentMethod === 'cash' || wantsGiftCard) &&
      selectedMachine?.selectionKind === 'livermore_pair' &&
      !form.cashMachineId
    ) errors.cashMachineId = t("Choose the machine you used.");
    if (needsCardDetails && !/^[0-9]{4}$/.test(form.cardLast4.trim())) {
      errors.cardLast4 = t("Enter only the last 4 digits shown for this payment.");
    }
    if (!form.issueCategory) {
      errors.issueCategory = t("Choose the option that best describes the problem.");
    }
    if (isCashChange) {
      if (!/^\d+(?:\.\d{1,2})?$/.test(form.cashInsertedAmount) || Number(form.cashInsertedAmount) <= 0) errors.cashInsertedAmount = t('Enter the cash you inserted.');
      if (!/^\d+(?:\.\d{1,2})?$/.test(form.expectedChangeAmount) || Number(form.expectedChangeAmount) <= 0) errors.expectedChangeAmount = t('Enter the change you expected.');
      else if (Number(form.expectedChangeAmount) >= Number(form.cashInsertedAmount)) errors.expectedChangeAmount = t('Expected change must be less than the cash inserted.');
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
      toast.error(t("Please check the highlighted fields."));
      return;
    }
    if (!hasValidIncidentLocalTime(incidentDate, incidentTime)) return;

    if (wantsGiftCard && !requiresManagerReview && !giftCardOffer && !isDemoMode) {
      setSubmissionError(t("Please wait for your gift card terms to load, then try again."));
      requestAnimationFrame(() => submissionErrorRef.current?.focus());
      return;
    }

    submissionLockRef.current = true;
    setIsSubmitting(true);
    setSubmissionError('');
    setQrSubmissionError(false);
    try {
      if (isDemoMode) {
        navigate('/refunds/thank-you?demo=on', {
          state: { reference: 'RF-DEMO-REQUEST', statusToken: null, paymentMethod: form.paymentMethod, resolutionMethod, requiresManagerReview },
        });
        return;
      }

      const requestInput = {
        selectionKey:
          qrClaim ||
          selectedMachine?.selectionKind === 'legacy_exact_machine' ||
          ((form.paymentMethod === 'cash' || wantsGiftCard) && selectedMachine?.selectionKind === 'livermore_pair')
            ? undefined
            : form.selectionKey,
        machineId:
          qrClaim?.machine.machineId ??
          ((form.paymentMethod === 'cash' || wantsGiftCard) && selectedMachine?.selectionKind === 'livermore_pair'
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
        paymentMethod: form.paymentMethod as 'card' | 'cash',
        resolutionMethod,
        giftCardOffer: wantsGiftCard && giftCardOffer ? { poolId: giftCardOffer.pool_id, value: giftCardOffer.value, expiresAt: giftCardOffer.expires_at } : undefined,
        paymentAmount: paymentAmount.trim(),
        cashInsertedAmount: isCashChange ? form.cashInsertedAmount.trim() : undefined,
        expectedChangeAmount: isCashChange ? form.expectedChangeAmount.trim() : undefined,
        customerLocale: locale,
        cardLast4: needsCardDetails ? form.cardLast4.trim() : undefined,
        cardLast4Source:
          needsCardDetails && form.cardLast4Source ? form.cardLast4Source : undefined,
        cardNetwork:
          needsCardDetails && form.cardNetwork ? form.cardNetwork : undefined,
        cardWalletUsed: needsCardDetails ? form.cardWalletUsed : undefined,
        paymentInteraction:
          form.paymentMethod === 'cash' ? 'cash' : needsCardDetails ? form.paymentInteraction || 'unsure' : 'unsure',
        walletProvider:
          needsCardDetails &&
          form.paymentInteraction === 'phone_watch_wallet' &&
          form.walletProvider
            ? form.walletProvider
            : undefined,
        walletDeviceKind:
          needsCardDetails &&
          form.paymentInteraction === 'phone_watch_wallet' &&
          form.walletDeviceKind
            ? form.walletDeviceKind
            : undefined,
        incidentTimeConfidence: form.incidentTimeConfidence || 'rough',
        incidentTimeSource: form.incidentTimeSource || undefined,
        issueCategory: form.issueCategory || 'other',
      };
      const storage = getRefundSessionStorage();
      const preparedSubmission = await prepareRefundSubmissionAttempt({
        current: submissionAttemptRef.current,
        input: requestInput,
        storage,
      });
      const submissionAttempt = preparedSubmission.attempt;
      submissionAttemptRef.current = submissionAttempt;
      submissionAttemptPersistedRef.current = preparedSubmission.persisted;
      const refundCase = await submitRefundRequest({
        ...requestInput,
        submissionId: submissionAttempt.submissionId,
      });

      const receiptPersisted = storeRefundSubmissionReceipt(storage, {
        publicReference: refundCase.publicReference,
        statusToken: refundCase.statusToken,
        statusExpiresAt: refundCase.statusExpiresAt,
        paymentMethod: form.paymentMethod as 'card' | 'cash',
        resolutionMethod,
        requiresManagerReview,
      });
      if (receiptPersisted && clearRefundSubmissionAttempt(storage)) {
        setForm(emptyForm);
        submissionAttemptRef.current = null;
        submissionAttemptPersistedRef.current = false;
      }
      navigate('/refunds/thank-you', {
        state: {
          reference: refundCase.publicReference,
          statusToken: refundCase.statusToken,
          statusExpiresAt: refundCase.statusExpiresAt,
          paymentMethod: form.paymentMethod,
          resolutionMethod,
          requiresManagerReview,
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
      const message = locale === 'es' ? t('Unable to submit refund request.') : error instanceof Error ? error.message : t('Unable to submit refund request.');
      const recoveryGuidance = submissionAttemptPersistedRef.current
        ? t("Your answers are still here. Try again to safely continue this same submission, even after refreshing this page.")
        : t("Your answers are still here. Try again without refreshing this page so we can safely continue this same submission.");
      setSubmissionError(
        `${message} ${recoveryGuidance}`,
      );
      requestAnimationFrame(() => submissionErrorRef.current?.focus());
    } finally {
      submissionLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Layout>
      <section lang={locale} className="section-padding bg-gradient-to-b from-pink-50 via-background to-background">
        <div className="container-page">
          <RefundCustomerLanguageToggle locale={locale} onChange={setLocale} />
          <div className="mx-auto max-w-3xl">
            <div className="mb-6 rounded-2xl border border-pink-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="inline-flex items-center gap-2 rounded-full bg-pink-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-pink-700">
                <Sparkles className="h-3.5 w-3.5" />
                Bloomjoy Sweets
              </div>
              <h1 className="mt-2 font-display text-3xl font-bold text-foreground sm:text-4xl">{t("Request a refund")}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                {giftCardAvailable ? t("Let’s make your next visit a little sweeter. Tell us about one purchase and choose a Bloomjoy gift card, or an original-payment refund for a card purchase.") : t("Tell us about one purchase so our team can review your request.")}
              </p>
            </div>

            {isDemoMode && (
              <div className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">{t("DEMO DATA - visual review only. This form uses synthetic locations and redirects to a demo thank-you page instead of creating a real refund case.")}</div>
            )}

            {hasNoLiveMachineOptions && (
              <div className="mb-4 rounded-md border border-pink-200 bg-pink-50 px-4 py-3 text-sm text-pink-950">
                {hasEmailContext ? (
                  <>{t("We could not load the Bloomjoy machine list right now. Please reply in the same email conversation with the machine location or a description of the machine, and our team will continue from there. You do not need to complete a second form.")}</>
                ) : (
                  <>{t("We could not load the Bloomjoy machine list right now. Please try this page again shortly. If it still does not load,")}{' '}
                    <a
                      href="mailto:info@bloomjoysweets.com?subject=Bloomjoy%20refund%20form%20help"
                      className="font-semibold underline underline-offset-2"
                    >{t("email Bloomjoy customer service")}</a>{t(". We will help you return to this Bloomjoy form. Sending an email does not submit a refund request.")}</>
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
                  <p className="font-semibold">{t("Confirming this machine")}</p>
                  <p className="mt-0.5 text-muted-foreground">{t("We are securely recording where and when you opened the refund form.")}</p>
                </div>
              </div>
            )}

            {hasQrClaimError && (
              <div
                className="mb-4 rounded-lg border border-pink-200 bg-pink-50 px-4 py-4 text-sm text-pink-950"
                role="alert"
              >
                <p className="font-semibold">{t("This machine's refund code is not available.")}</p>
                {hasEmailContext ? (
                  <p className="mt-1 leading-6">{t("Please reply in the same email conversation with the machine location or a description of the machine. You do not need to open another form.")}</p>
                ) : (
                  <>
                    <p className="mt-1 leading-6">{t("The code may have been replaced or disabled. You can still submit a request using the regular form and choose the machine yourself.")}</p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <Button asChild size="sm">
                        <Link to="/refunds/request">{t("Use regular refund form")}</Link>
                      </Button>
                      <a
                        href="mailto:info@bloomjoysweets.com?subject=Bloomjoy%20refund%20form%20help"
                        className="inline-flex min-h-9 items-center font-semibold underline underline-offset-2"
                      >{t("Email Bloomjoy customer service")}</a>
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
                <p className="font-semibold">{t("This QR session needs to be restarted.")}</p>
                {hasEmailContext ? (
                  <p className="mt-1 leading-6">{t("Please reply in the same email conversation so our team can continue without creating a second request.")}</p>
                ) : (
                  <>
                    <p className="mt-1 leading-6">{t("Your form is still here. Start a new QR session, then submit it again. You can also switch to the regular form.")}</p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <Button type="button" size="sm" onClick={() => window.location.reload()}>{t("Start new QR session")}</Button>
                      <Button asChild type="button" size="sm" variant="outline">
                        <Link to="/refunds/request">{t("Use regular refund form")}</Link>
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
                <div className="grid grid-cols-1 gap-5">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">{t("Purchase")}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{t("Where and when did you make the purchase?")}</p>
                  </div>
                  {qrClaim ? (
                    <div className="rounded-lg border border-pink-200 bg-pink-50 px-4 py-4 text-pink-950">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 rounded-full bg-white p-2 text-pink-700 shadow-sm">
                          <MapPin className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold">{t("Machine confirmed")}</p>
                            <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs font-semibold text-pink-800">
                              <CheckCircle2 className="h-3.5 w-3.5" />{t("QR verified")}</span>
                          </div>
                          <p className="mt-1 text-sm leading-6">
                            {formatMachineOption(
                              qrClaim.machine.locationName,
                              qrClaim.machine.machineLabel
                            )}
                          </p>
                          <p className="mt-2 flex items-start gap-2 text-xs leading-5 text-pink-900">
                            <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>{t("We saved the server time as")}{' '}
                              <strong>
                                {formatQrOpenedTime(
                                  qrClaim.openedAt,
                                  qrClaim.machine.locationTimezone, locale
                                )}
                              </strong>{t(". You will still enter the approximate purchase time below.")}</span>
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Label htmlFor="machine">{t("Machine location")}</Label>
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
                            ? t("Loading locations...")
                            : hasNoLiveMachineOptions
                              ? t("Refund form is not open yet")
                              : t("Choose a location")}
                        </option>
                        {machines.map((machine) => (
                          <option key={machine.selectionKey} value={machine.selectionKey}>
                            {machine.displayLabel}
                          </option>
                        ))}
                      </select>
                      {fieldErrors.selectionKey && (
                        <p id="machine-error" className="mt-1.5 text-sm text-destructive" role="alert">
                          {t(fieldErrors.selectionKey)}
                        </p>
                      )}
                    </div>
                  )}

                <div>
                  <Label htmlFor="customer-email">{t("Email")}</Label>
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
                      {t(fieldErrors.customerEmail)}
                    </p>
                  )}
                  <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{t("We use this only for this request and its secure status link.")}</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="incident-date">{t("Purchase date")}</Label>
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
                        {t(fieldErrors.incidentDate)}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="incident-time">{t("Approximate purchase time")}</Label>
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
                        {t(fieldErrors.incidentTime)}
                      </p>
                    )}
                  </div>
                </div>

                <section
                  data-testid="refund-payment-section"
                  className="space-y-4 border-t border-border pt-5"
                >
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">{t("Payment")}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {giftCardAvailable ? t("Cash purchases receive a Bloomjoy gift card. For card purchases, you can choose a gift card or a refund to your original payment.") : t("Tell us how you paid. Our team will review your request.")}
                    </p>
                  </div>

                <fieldset className="min-w-0">
                  <legend className="text-sm font-medium leading-none">{t("How did you pay?")}</legend>
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
                        <span className="block font-semibold text-foreground">{t("Card")}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                          {giftCardAvailable ? t("Gift card or original-payment refund.") : t("Refund to your original card payment.")}
                        </span>
                      </span>
                    </Label>
                    <Label
                      htmlFor="payment-method-cash"
                      className="flex min-h-16 cursor-pointer items-center gap-3 rounded-lg border border-input bg-white px-4 py-3 font-normal transition-colors has-[[data-state=checked]]:border-pink-500 has-[[data-state=checked]]:bg-pink-50"
                    >
                      <RadioGroupItem id="payment-method-cash" value="cash" />
                      <span>
                        <span className="block font-semibold text-foreground">{t("Cash")}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                          {giftCardAvailable ? t("Bloomjoy gift card. No payment details needed.") : t("Cash purchase. No card details needed.")}
                        </span>
                      </span>
                    </Label>
                  </RadioGroup>
                </fieldset>

                {!isCashChange && <div>
                  <Label htmlFor="payment-amount">{t("Amount paid")}</Label>
                  <Input
                    id="payment-amount"
                    inputMode="decimal"
                    placeholder={t("Example: 12.00")}
                    value={form.paymentAmount}
                    onChange={(event) => updateForm('paymentAmount', event.target.value)}
                    aria-invalid={Boolean(fieldErrors.paymentAmount)}
                    aria-describedby={fieldErrors.paymentAmount ? 'payment-amount-error' : undefined}
                    className="mt-2 h-11"
                  />
                  {fieldErrors.paymentAmount && (
                    <p id="payment-amount-error" className="mt-1.5 text-sm text-destructive" role="alert">
                      {t(fieldErrors.paymentAmount)}
                    </p>
                  )}
                </div>}

                {(form.paymentMethod === 'cash' || wantsGiftCard) &&
                  selectedMachine?.selectionKind === 'livermore_pair' && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                      <Label htmlFor="cash-machine">{t("Which machine did you use?")}</Label>
                      <select
                        id="cash-machine"
                        value={form.cashMachineId}
                        onChange={(event) => updateForm('cashMachineId', event.target.value)}
                        aria-invalid={Boolean(fieldErrors.cashMachineId)}
                        aria-describedby={fieldErrors.cashMachineId ? 'cash-machine-error' : undefined}
                        className="mt-2 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                      >
                        <option value="">{t("Choose the machine label")}</option>
                        {(selectedMachine.cashMachineOptions ?? []).map((machine) => (
                          <option key={machine.machineId} value={machine.machineId}>
                            {machine.displayLabel}
                          </option>
                        ))}
                      </select>
                      {fieldErrors.cashMachineId && (
                        <p id="cash-machine-error" className="mt-1.5 text-sm text-destructive" role="alert">
                          {t(fieldErrors.cashMachineId)}
                        </p>
                      )}
                      <p className="mt-2 text-xs leading-5 text-amber-900">{t("Look for the small TT label on the machine.")}</p>
                    </div>
                  )}

                <section aria-labelledby="resolution-heading" className="space-y-3 border-t border-border pt-5">
                  <h2 id="resolution-heading" className="text-lg font-semibold">{t("How can we make it right?")}</h2>
                  {form.paymentMethod === 'card' && giftCardAvailable && <RadioGroup value={form.resolutionMethod}
                    onValueChange={(value) => { updateForm('resolutionMethod', value); setFieldErrors((current) => ({ ...current, cardLast4: undefined })); }}
                    aria-label={t("Resolution")} className="gap-3">
                    <Label htmlFor="resolution-gift-card" className="flex min-h-11 cursor-pointer items-center gap-3 font-normal">
                      <RadioGroupItem id="resolution-gift-card" value="gift_card" />
                      <span><span className="font-semibold">{t("Bloomjoy gift card")}</span> <span className="text-xs text-pink-800">{t("Recommended")}</span>
                        <span className="block text-sm leading-6 text-muted-foreground">{t(requiresManagerReview ? t("Your request will be reviewed by a manager. We will email you when the review is complete.") : t("Usually emailed within a few hours."))}</span>
                      </span>
                    </Label>
                    <Label htmlFor="resolution-original" className="flex min-h-11 cursor-pointer items-center gap-3 font-normal">
                      <RadioGroupItem id="resolution-original" value="original_payment" />
                      <span>{t("Refund to my original card payment")}<span className="block text-sm leading-6 text-muted-foreground">{t("We investigate the purchase and request your refund from the payment processor, so this takes longer.")}</span>
                      </span>
                    </Label>
                  </RadioGroup>}
                  {wantsGiftCard && <div className="space-y-2 rounded-lg border border-pink-200 bg-pink-50 p-4" aria-live="polite">
                    {requiresManagerReview ? <>
                      <p className="text-sm font-semibold leading-6">{t('Proposed gift card. A manager will review the amount before it is issued.')}</p>
                      {giftCardOffer && <RefundGiftCardTerms offer={giftCardOffer} locale={locale} hideValue />}
                      <p className="text-xs leading-5 text-pink-900">{t('Submitting accepts the gift card terms. The final amount depends on manager review.')}</p>
                    </> : giftCardOffer ? <><RefundGiftCardTerms offer={giftCardOffer} locale={locale} />
                      <p className="text-sm leading-6">{locale === 'es' ? 'Use el código y siga las instrucciones del correo con su tarjeta de regalo.' : giftCardOffer.redemption_instructions}</p>
                      <p className="text-xs leading-5 text-pink-900">{t("Submitting accepts this gift card and its terms. One automatic gift card per email in 12 months; repeat requests are reviewed by our team.")}</p>
                    </> : <p className="text-sm leading-6">{!form.selectionKey || Number(form.paymentAmount) <= 0
                      ? t("Choose the machine and enter your purchase amount to see your gift card value and terms.")
                      : offerQuery.isFetching ? t("Loading your gift card value and terms…")
                      : t("We could not load a gift card offer for this purchase right now. Please try again, or contact us using the same email conversation.")}</p>}
                    {!requiresManagerReview && offerQuery.isError && <Button type="button" variant="outline" onClick={() => void offerQuery.refetch()}>{t("Try loading the offer again")}</Button>}
                  </div>}
                  {!wantsGiftCard && <p className="text-sm leading-6 text-muted-foreground">{giftCardAvailable
                    ? t("Most requests are reviewed within 5 business days. We’ll email you with an update.")
                    : form.paymentMethod === 'card'
                      ? t("We investigate the purchase and request your refund from the payment processor, so this takes longer. Most requests are reviewed within 5 business days.")
                      : t("We’ll find your payment and send it to our team for a refund decision. Most requests are reviewed within 5 business days.")}</p>}
                </section>

                {needsCardDetails && (
                  <div className="rounded-lg border border-pink-200 bg-pink-50 p-4 text-sm text-pink-950">
                    <div>
                      <Label htmlFor="card-last4">
                        {form.cardWalletUsed
                          ? t("Virtual last 4 shown in your wallet")
                          : t("Last 4 digits shown for this payment")}
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
                          {t(fieldErrors.cardLast4)}
                        </p>
                      )}
                      <p id="card-last4-guidance" className="mt-2 leading-6 text-pink-900">
                        {form.cardWalletUsed
                          ? t("Open the card details in Apple Pay or your wallet on the exact phone or watch you used. A phone and watch can show different last 4 digits for the same physical card. Use the virtual last 4 shown for this wallet payment. Do not use the last 4 printed on the physical card.")
                          : t("Enter only 4 digits—never a full card number, security code, or screenshot.")}
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
                            walletDeviceKind: usedWallet ? current.walletDeviceKind : '',
                          }));
                        }}
                        className="h-4 w-4 rounded border-input accent-pink-600"
                      />
                      <span>{t("I used Apple Pay or another phone/watch wallet")}</span>
                    </label>
                    {form.cardWalletUsed && (
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <div>
                        <Label htmlFor="wallet-provider">{t("Wallet (optional)")}</Label>
                        <select
                          id="wallet-provider"
                          value={form.walletProvider}
                          onChange={(event) =>
                            updateForm('walletProvider', event.target.value as RefundWalletProvider)
                          }
                          className="mt-2 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                        >
                          <option value="">{t("Choose if known")}</option>
                          <option value="apple_pay">Apple Pay</option>
                          <option value="google_wallet">Google Wallet</option>
                          <option value="other">{t("Another wallet")}</option>
                          <option value="unsure">{t("I am not sure")}</option>
                        </select>
                        </div>
                        <div>
                          <Label htmlFor="wallet-device-kind">{t("Device used (optional)")}</Label>
                          <select
                            id="wallet-device-kind"
                            value={form.walletDeviceKind}
                            onChange={(event) =>
                              updateForm('walletDeviceKind', event.target.value as RefundWalletDeviceKind)
                            }
                            className="mt-2 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                          >
                            <option value="">{t("Choose if known")}</option>
                            <option value="phone">{t("Phone")}</option>
                            <option value="watch">{t("Watch")}</option>
                            <option value="unknown">{t("I am not sure")}</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                </section>

                <div className="border-t border-border pt-5">
                  <h2 className="text-lg font-semibold text-foreground">{t("What happened")}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{t("Tell us what went wrong with the purchase.")}</p>
                </div>

                <div>
                  <Label htmlFor="issue-category">{t("What best describes the problem?")}</Label>
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
                    <option value="">{t("Choose one")}</option>
                    <option value="charged_no_product">
                      {form.paymentMethod === 'cash'
                        ? t("Paid, but no product came out")
                        : t("Charged, but no product came out")}
                    </option>
                    <option value="product_problem">{t("The product came out incorrectly")}</option>
                    <option value="charged_more_than_once">
                      {form.paymentMethod === 'cash' ? t("Paid more than once") : t("Charged more than once")}
                    </option>
                    <option value="wrong_amount">
                      {form.paymentMethod === 'cash' ? t("Machine took the wrong amount") : t("Charged the wrong amount")}
                    </option>
                    <option value="partial_items">{t('Received fewer items than I paid for')}</option>
                    {form.paymentMethod === 'cash' && !legacyCash && <option value="expected_cash_change">{t('Expected change from a cash payment')}</option>}
                    <option value="other">{t("Something else")}</option>
                  </select>
                  {fieldErrors.issueCategory && (
                    <p id="issue-category-error" className="mt-1.5 text-sm text-destructive" role="alert">
                      {t(fieldErrors.issueCategory)}
                    </p>
                  )}
                </div>

                {isPartialItems && <p className="text-sm leading-6 text-muted-foreground">{t('Tell us how many items you paid for and how many you received in the optional details below.')}</p>}
                {isCashChange && <fieldset className="space-y-4 rounded-xl border border-pink-200 bg-pink-50 p-4">
                  <legend className="px-1 text-sm font-semibold">{t('Expected change from a cash payment')}</legend>
                  <p className="text-sm leading-6">{t('Our machines do not provide change. Our team will review your request for a courtesy gift card.')}</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {(['cashInsertedAmount', 'expectedChangeAmount'] as const).map((key) => <div key={key}>
                      <Label htmlFor={fieldElementId[key]}>{t(key === 'cashInsertedAmount' ? t("Cash inserted") : t("Change you expected"))}</Label>
                      <Input id={fieldElementId[key]} inputMode="decimal" className="mt-2 h-11 bg-white" value={form[key]}
                        onChange={(event) => updateForm(key, event.target.value)} aria-invalid={Boolean(fieldErrors[key])}
                        aria-describedby={fieldErrors[key] ? `${fieldElementId[key]}-error` : undefined} />
                      {fieldErrors[key] && <p id={`${fieldElementId[key]}-error`} role="alert" className="mt-1.5 text-sm text-destructive">{t(fieldErrors[key])}</p>}
                    </div>)}
                  </div>
                  {reportedProductCost > 0 && form.cashInsertedAmount && form.expectedChangeAmount && <p className="text-sm leading-6">{locale === 'es' ? 'Costo de los productos informado' : 'Reported product cost'}: ${reportedProductCost.toFixed(2)}. {locale === 'es' ? 'Se calcula a partir de los importes que indicó; aún no se ha verificado.' : 'Calculated from the amounts you entered; not yet verified.'}</p>}
                </fieldset>}
                {requiresManagerReview && <p role="status" className="rounded-lg border border-pink-200 bg-pink-50 p-4 text-sm leading-6">{t('Your request will be reviewed by a manager. We will email you when the review is complete.')}</p>}

                <details className="rounded-xl border border-border bg-muted/20 p-4">
                  <summary className="cursor-pointer font-semibold text-foreground">{t("Add optional details")}</summary>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("These can help with unusual purchases. You can submit your request without them.")}</p>
                  <div className="mt-4 grid gap-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="customer-name">{t("Name (optional)")}</Label>
                        <Input
                          id="customer-name"
                          value={form.customerName}
                          onChange={(event) => updateForm('customerName', event.target.value)}
                          autoComplete="name"
                          className="mt-2 bg-white"
                        />
                      </div>
                      <div>
                        <Label htmlFor="customer-phone">{t("Phone (optional)")}</Label>
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
                      <Label htmlFor="incident-time-confidence">{t("How close is the time? (optional)")}</Label>
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
                        <option value="">{t("Just a rough estimate")}</option>
                        <option value="exact">{t("Exact or within a few minutes")}</option>
                        <option value="within_15_minutes">{t("Within about 15 minutes")}</option>
                        <option value="within_1_hour">{t("Within about 1 hour")}</option>
                        <option value="rough">{t("Just a rough estimate")}</option>
                      </select>
                    </div>

                    <div>
                      <Label htmlFor="incident-time-source">{t("How did you find the time? (optional)")}</Label>
                      <select
                        id="incident-time-source"
                        value={form.incidentTimeSource}
                        onChange={(event) =>
                          updateForm('incidentTimeSource', event.target.value as RefundIncidentTimeSource)
                        }
                        className="mt-2 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                      >
                        <option value="">{t("Choose if known")}</option>
                        <option value="transaction_alert_or_receipt">{t("Purchase alert or receipt")}</option>
                        <option value="memory">{t("From memory")}</option>
                        <option value="unknown">{t("I am not sure")}</option>
                      </select>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">{t("A bank posting time can differ from when you used the machine.")}</p>
                    </div>

                    {needsCardDetails && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        {!form.cardWalletUsed && (
                          <div>
                            <Label htmlFor="payment-interaction">{t("How did you use the card? (optional)")}</Label>
                            <select
                              id="payment-interaction"
                              value={form.paymentInteraction}
                              onChange={(event) =>
                                updateForm('paymentInteraction', event.target.value as RefundPaymentInteraction)
                              }
                              className="mt-2 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                            >
                              <option value="">{t("Not sure")}</option>
                              <option value="tap_card">{t("Tapped the card")}</option>
                              <option value="insert_card">{t("Inserted the card")}</option>
                              <option value="swipe_card">{t("Swiped the card")}</option>
                              <option value="insert_or_swipe">{t("Inserted or swiped — not sure which")}</option>
                              <option value="unsure">{t("I am not sure")}</option>
                            </select>
                          </div>
                        )}
                        <div>
                          <Label htmlFor="card-network">{t("Card type (optional)")}</Label>
                          <select
                            id="card-network"
                            value={form.cardNetwork}
                            onChange={(event) =>
                              updateForm('cardNetwork', event.target.value as RefundCardNetwork)
                            }
                            className="mt-2 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                          >
                            <option value="">{t("Choose if known")}</option>
                            <option value="visa">Visa</option>
                            <option value="mastercard">Mastercard</option>
                            <option value="discover">Discover</option>
                            <option value="american_express">American Express</option>
                            <option value="other_unknown">{t("Other / Not sure")}</option>
                          </select>
                        </div>
                        <div>
                          <Label htmlFor="card-last4-source">{t("Where did you find the last 4? (optional)")}</Label>
                          <select
                            id="card-last4-source"
                            value={form.cardLast4Source}
                            onChange={(event) =>
                              updateForm('cardLast4Source', event.target.value as RefundCardLast4Source)
                            }
                            className="mt-2 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                          >
                            <option value="">{t("Choose if known")}</option>
                            <option value="physical_card">{t("Physical card")}</option>
                            <option value="wallet_device">{t("Card shown for the wallet or device")}</option>
                            <option value="bank_record">{t("Bank record or purchase alert")}</option>
                            <option value="unknown">{t("I am not sure")}</option>
                          </select>
                        </div>
                      </div>
                    )}

                    <div>
                      <Label htmlFor="issue-summary">{t("Anything else? (optional)")}</Label>
                      <Textarea
                        id="issue-summary"
                        value={form.issueSummary}
                        onChange={(event) => updateForm('issueSummary', event.target.value)}
                        rows={4}
                        placeholder={t("For example, whether anything came out or what the screen showed.")}
                        className="mt-2 bg-white"
                      />
                    </div>
                  </div>
                </details>

                  {submissionError && (
                    <div
                      ref={submissionErrorRef}
                      tabIndex={-1}
                      role="alert"
                      className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm leading-6 text-foreground"
                    >
                      <p className="font-semibold">{t("We could not confirm your request.")}</p>
                      <p className="mt-1">{submissionError}</p>
                    </div>
                  )}

                  <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-2 text-sm text-muted-foreground">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>
                        {selectedMachine
                          ? qrClaim
                            ? `${locale === 'es' ? 'QR confirmado' : 'QR confirmed'}: ${selectedMachine.displayLabel}`
                            : `${locale === 'es' ? 'Seleccionada' : 'Selected'}: ${selectedMachine.displayLabel}`
                          : t("Your request goes to the manager responsible for that machine.")}
                      </span>
                    </div>
                    <Button
                      type="submit"
                      className="min-h-11"
                      disabled={
                        isSubmitting || isLoadingMachineContext || hasNoLiveMachineOptions || (wantsGiftCard && !requiresManagerReview && !giftCardOffer && !isDemoMode)
                      }
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("Sending your request...")}</>
                      ) : (
                        requiresManagerReview ? t('Send request for review') : wantsGiftCard ? t("Accept gift card & send request") : t("Send refund request")
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

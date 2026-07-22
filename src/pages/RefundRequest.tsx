import { type FormEvent, useMemo, useState } from 'react';
import { Loader2, Paperclip, ShieldCheck, Sparkles } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  fetchRefundMachineOptions,
  buildLocalRefundMachineOptions,
  isLocalUatDemoForced,
  submitRefundRequest,
  type RefundAttachmentInput,
  type RefundPaymentMethod,
} from '@/lib/refundOperations';

const maxAttachments = 3;
const maxAttachmentBytes = 5 * 1024 * 1024;

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

const readFileAsBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read file.'));
    reader.readAsDataURL(file);
  });

const buildIncidentIso = (incidentDate: string, incidentTime: string) => {
  const date = new Date(`${incidentDate}T${incidentTime}`);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
};

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

export default function RefundRequestPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [files, setFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isDemoMode = isLocalUatDemoForced();

  const {
    data: liveMachines = [],
    isLoading: isLoadingMachines,
    error: machineError,
  } = useQuery({
    queryKey: ['public-refund-machine-options'],
    queryFn: fetchRefundMachineOptions,
    enabled: !isDemoMode,
    staleTime: 1000 * 60 * 5,
  });
  const machines = isDemoMode ? buildLocalRefundMachineOptions() : liveMachines;
  const hasAvailableMachines = machines.length > 0;
  const hasNoLiveMachineOptions = !isDemoMode && !isLoadingMachines && !machineError && !hasAvailableMachines;

  const selectedMachine = useMemo(
    () => machines.find((machine) => machine.machineId === form.machineId) ?? null,
    [form.machineId, machines]
  );

  const updateForm = (key: keyof typeof form, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleFilesChange = (nextFiles: FileList | null) => {
    const selectedFiles = Array.from(nextFiles ?? []);
    const validFiles = selectedFiles.slice(0, maxAttachments);
    const oversized = validFiles.find((file) => file.size > maxAttachmentBytes);

    if (selectedFiles.length > maxAttachments) {
      toast.info('Only the first 3 photos were attached.');
    }

    if (oversized) {
      toast.error('Each photo must be 5MB or smaller.');
      return;
    }

    setFiles(validFiles);
  };

  const buildAttachments = async (): Promise<RefundAttachmentInput[]> =>
    Promise.all(
      files.map(async (file) => ({
        fileName: file.name,
        contentType: file.type,
        byteSize: file.size,
        base64: await readFileAsBase64(file),
      }))
    );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (hasNoLiveMachineOptions) {
      toast.error('This refund form is not open for customer submissions yet.');
      return;
    }

    if (!form.machineId) {
      toast.error('Choose the machine location so we can route your request.');
      return;
    }

    const incidentAt = buildIncidentIso(form.incidentDate, form.incidentTime);
    if (!incidentAt) {
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
    try {
      if (isDemoMode) {
        navigate('/refunds/thank-you?ref=RF-DEMO-REQUEST&demo=on');
        return;
      }

      const attachments = await buildAttachments();
      const refundCase = await submitRefundRequest({
        machineId: form.machineId,
        customerName: form.customerName.trim(),
        customerEmail: form.customerEmail.trim().toLowerCase(),
        customerPhone: form.customerPhone.trim(),
        zellePaymentContact:
          form.paymentMethod === 'cash' ? form.zellePaymentContact.trim() : undefined,
        issueSummary: form.issueSummary.trim(),
        incidentAt,
        paymentMethod: form.paymentMethod,
        paymentAmount: form.paymentAmount.trim(),
        cardLast4: form.paymentMethod === 'card' ? form.cardLast4.trim() : undefined,
        cardWalletUsed: form.cardWalletUsed,
        attachments,
      });

      setForm(emptyForm);
      setFiles([]);
      navigate(`/refunds/thank-you?ref=${encodeURIComponent(refundCase?.publicReference ?? '')}`);
    } catch (error) {
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
                We are getting this new Bloomjoy refund form ready for selected machines. For now,
                please use the{' '}
                <a
                  href="https://forms.gle/qQDt2V7dFBFPqjyW6"
                  className="font-semibold underline underline-offset-2"
                >
                  current customer service form
                </a>{' '}
                and our team will review your request with care.
              </div>
            )}

            <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
              <div className="grid gap-5">
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
                    <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
                      <div>
                        <Label htmlFor="card-last4">Last 4 digits on the card charge</Label>
                        <Input
                          id="card-last4"
                          inputMode="numeric"
                          maxLength={4}
                          value={form.cardLast4}
                          onChange={(event) =>
                            updateForm('cardLast4', event.target.value.replace(/\D/g, '').slice(0, 4))
                          }
                          required
                          className="mt-2 bg-white"
                        />
                      </div>
                      <label className="mt-7 flex items-start gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked={form.cardWalletUsed}
                          onChange={(event) => updateForm('cardWalletUsed', event.target.checked)}
                          className="mt-1 h-4 w-4 rounded border-input"
                        />
                        <span>
                          I used Apple Pay, Google Pay, or another wallet. Wallet payments can show
                          a virtual last 4 that differs from the physical card.
                        </span>
                      </label>
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

                <div>
                  <Label htmlFor="photos">Photos</Label>
                  <div className="mt-2 rounded-lg border border-dashed border-border bg-muted/20 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-start gap-3 text-sm text-muted-foreground">
                        <Paperclip className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          Optional images of the machine, payment screen, or product issue. Up to 3
                          photos, 5MB each.
                        </span>
                      </div>
                      <Input
                        id="photos"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        multiple
                        onChange={(event) => handleFilesChange(event.target.files)}
                        className="max-w-sm bg-background"
                      />
                    </div>
                    {files.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {files.map((file) => (
                          <span
                            key={`${file.name}-${file.size}`}
                            className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground"
                          >
                            {file.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-2 text-sm text-muted-foreground">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>
                      {selectedMachine
                        ? `Selected: ${formatMachineOption(selectedMachine.locationName, selectedMachine.machineLabel)}`
                        : 'Your request goes to the Bloomjoy operations team.'}
                    </span>
                  </div>
                  <Button type="submit" disabled={isSubmitting || isLoadingMachines || hasNoLiveMachineOptions}>
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
          </div>
        </div>
      </section>
    </Layout>
  );
}

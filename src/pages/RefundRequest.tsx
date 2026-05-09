import { type FormEvent, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Paperclip, ShieldCheck } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  fetchRefundMachineOptions,
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

export default function RefundRequestPage() {
  const [form, setForm] = useState(emptyForm);
  const [files, setFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedReference, setSubmittedReference] = useState('');

  const {
    data: machines = [],
    isLoading: isLoadingMachines,
    error: machineError,
  } = useQuery({
    queryKey: ['public-refund-machine-options'],
    queryFn: fetchRefundMachineOptions,
    staleTime: 1000 * 60 * 5,
  });

  const selectedMachine = useMemo(
    () => machines.find((machine) => machine.machineId === form.machineId) ?? null,
    [form.machineId, machines]
  );

  const updateForm = (key: keyof typeof form, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleFilesChange = (nextFiles: FileList | null) => {
    const validFiles = Array.from(nextFiles ?? []).slice(0, maxAttachments);
    const oversized = validFiles.find((file) => file.size > maxAttachmentBytes);

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

    const incidentAt = buildIncidentIso(form.incidentDate, form.incidentTime);
    if (!incidentAt) {
      toast.error('Enter the date and time when the issue happened.');
      return;
    }

    if (form.paymentMethod === 'card' && !/^[0-9]{4}$/.test(form.cardLast4.trim())) {
      toast.error('Enter the last 4 digits shown for the card payment.');
      return;
    }

    setIsSubmitting(true);
    try {
      const attachments = await buildAttachments();
      const refundCase = await submitRefundRequest({
        machineId: form.machineId,
        customerName: form.customerName.trim(),
        customerEmail: form.customerEmail.trim().toLowerCase(),
        customerPhone: form.customerPhone.trim(),
        issueSummary: form.issueSummary.trim(),
        incidentAt,
        paymentMethod: form.paymentMethod,
        paymentAmount: form.paymentAmount.trim(),
        cardLast4: form.paymentMethod === 'card' ? form.cardLast4.trim() : undefined,
        cardWalletUsed: form.cardWalletUsed,
        attachments,
      });

      setSubmittedReference(refundCase?.publicReference ?? '');
      setForm(emptyForm);
      setFiles([]);
      toast.success('Refund request submitted.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to submit refund request.';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Layout>
      <section className="section-padding bg-gradient-to-b from-background via-background to-muted/30">
        <div className="container-page">
          <div className="mx-auto max-w-3xl">
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Bloomjoy Sweets
              </p>
              <h1 className="mt-2 font-display text-3xl font-bold text-foreground sm:text-4xl">
                Refund Request
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                Share the machine, timing, payment details, and what happened. The operations team
                will review it with care and follow up by email.
              </p>
            </div>

            {submittedReference && (
              <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-semibold">Request received: {submittedReference}</p>
                    <p className="mt-1">
                      We sent a confirmation email. Please keep the reference handy if you reply
                      with more details.
                    </p>
                  </div>
                </div>
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
                    className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">
                      {isLoadingMachines ? 'Loading locations...' : 'Choose a location'}
                    </option>
                    {machines.map((machine) => (
                      <option key={machine.machineId} value={machine.machineId}>
                        {machine.locationName} - {machine.machineLabel}
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
                      <option value="unknown">Not sure</option>
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
                      className="mt-2"
                    />
                  </div>
                </div>

                {form.paymentMethod === 'card' && (
                  <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
                    <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
                      <div>
                        <Label htmlFor="card-last4">Last 4 digits</Label>
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

                <div>
                  <Label htmlFor="issue-summary">What happened?</Label>
                  <Textarea
                    id="issue-summary"
                    value={form.issueSummary}
                    onChange={(event) => updateForm('issueSummary', event.target.value)}
                    required
                    rows={6}
                    placeholder="Tell us what went wrong, whether cotton candy was dispensed, and anything visible on the machine screen."
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
                        ? `Selected: ${selectedMachine.locationName} - ${selectedMachine.machineLabel}`
                        : 'Your request goes to the Bloomjoy operations team.'}
                    </span>
                  </div>
                  <Button type="submit" disabled={isSubmitting || isLoadingMachines}>
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

import { Loader2, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  RefundNayaxResolutionEvidenceType,
  RefundNayaxResolutionResult,
} from '@/lib/refundOperations';

type ResolutionOption<Value extends string> = {
  value: Value;
  label: string;
};

type RefundNayaxResolutionFormPresentation = {
  result: {
    value: RefundNayaxResolutionResult;
    options: Array<ResolutionOption<RefundNayaxResolutionResult>>;
    helper?: string;
  };
  evidence: {
    value: RefundNayaxResolutionEvidenceType;
    options: Array<ResolutionOption<RefundNayaxResolutionEvidenceType>>;
  };
  reference: {
    value: string;
    issue: string | null;
  };
  occurredAt: string;
  timezone: {
    value: string;
    defaultMissing: boolean;
  };
  submit: {
    label: string;
    disabled: boolean;
    pending: boolean;
  };
};

type RefundNayaxResolutionPresentation = {
  operations: {
    slaMinutes: number;
    overdue: boolean;
    recordedPaymentStep: string;
  } | null;
  action:
    | { kind: 'blocked'; message: string }
    | { kind: 'form'; form: RefundNayaxResolutionFormPresentation };
};

export type RefundNayaxOutcomeResolutionPresentation = {
  freeze: {
    testId: 'refund-legacy-state-freeze' | 'refund-customer-decision-freeze';
    message: string;
  };
  resolution: RefundNayaxResolutionPresentation | null;
};

type RefundNayaxOutcomeResolutionPanelProps = {
  presentation: RefundNayaxOutcomeResolutionPresentation;
  onResultChange: (result: RefundNayaxResolutionResult) => void;
  onEvidenceTypeChange: (evidenceType: RefundNayaxResolutionEvidenceType) => void;
  onReferenceChange: (reference: string) => void;
  onOccurredAtChange: (occurredAt: string) => void;
  onTimezoneChange: (timezone: string) => void;
  onPrepare: () => void;
};

export function RefundNayaxOutcomeResolutionPanel({
  presentation,
  onResultChange,
  onEvidenceTypeChange,
  onReferenceChange,
  onOccurredAtChange,
  onTimezoneChange,
  onPrepare,
}: RefundNayaxOutcomeResolutionPanelProps) {
  const resolution = presentation.resolution;

  return (
    <>
      <div
        data-testid={presentation.freeze.testId}
        role="status"
        className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground"
      >
        <p>{presentation.freeze.message}</p>
      </div>

      {resolution && (
        <div
          data-testid="refund-nayax-resolution-panel"
          className="mt-4 space-y-4 border-t border-border pt-4 text-foreground"
        >
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-semibold">Payment result check</p>
              <p className="mt-1 text-sm leading-6">
                Record what Nayax confirmed. This uses the original approval and can never create a second refund.
              </p>
            </div>
          </div>
          {resolution.operations && (
            <div
              data-testid="refund-operations-sla"
              className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm sm:grid-cols-3"
            >
              <div>
                <p className="text-xs text-muted-foreground">Owner</p>
                <p className="mt-1 font-medium">Machine Manager</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Review within</p>
                <p className="mt-1 font-medium">
                  {resolution.operations.slaMinutes} minutes
                  {resolution.operations.overdue ? ', overdue' : ''}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Recorded payment step</p>
                <p className="mt-1 font-medium">{resolution.operations.recordedPaymentStep}</p>
              </div>
              <p className="sm:col-span-3">
                Check and record the confirmed Nayax result. Never retry the payment while its result is unknown.
              </p>
            </div>
          )}

          {resolution.action.kind === 'blocked' ? (
            <div
              data-testid="refund-nayax-resolution-blocked"
              className="rounded-md border border-border bg-muted/30 p-3 text-sm"
            >
              <p className="font-medium">No manager action is available yet.</p>
              <p className="mt-1 text-muted-foreground">{resolution.action.message}</p>
            </div>
          ) : (
            <div className="grid gap-4">
              <div>
                <Label htmlFor="refund-nayax-resolution-result">What is the confirmed payment result?</Label>
                <select
                  id="refund-nayax-resolution-result"
                  data-testid="refund-nayax-resolution-result"
                  value={resolution.action.form.result.value}
                  onChange={(event) => onResultChange(event.target.value as RefundNayaxResolutionResult)}
                  className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {resolution.action.form.result.options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {resolution.action.form.result.helper}
                </p>
              </div>

              <div>
                <div>
                  <Label htmlFor="refund-nayax-resolution-evidence-type">Confirmation source</Label>
                  <select
                    id="refund-nayax-resolution-evidence-type"
                    data-testid="refund-nayax-resolution-evidence-type"
                    value={resolution.action.form.evidence.value}
                    onChange={(event) =>
                      onEvidenceTypeChange(event.target.value as RefundNayaxResolutionEvidenceType)}
                    className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {resolution.action.form.evidence.options.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <Label htmlFor="refund-nayax-resolution-reference">Reference number</Label>
                <Input
                  id="refund-nayax-resolution-reference"
                  data-testid="refund-nayax-resolution-reference"
                  value={resolution.action.form.reference.value}
                  onChange={(event) => onReferenceChange(event.target.value)}
                  placeholder="Nayax evidence reference"
                  aria-describedby="refund-nayax-resolution-reference-help"
                  autoComplete="off"
                  className="mt-2 bg-background"
                />
                <p id="refund-nayax-resolution-reference-help" className="mt-2 text-xs leading-5 text-muted-foreground">
                  Enter the Nayax ticket number (for example, CS1500666) or the reference from the transaction record. Do not include customer or card details.
                </p>
                {resolution.action.form.reference.issue && resolution.action.form.reference.value.trim() ? (
                  <p className="mt-2 text-xs font-medium text-destructive" role="alert">
                    {resolution.action.form.reference.issue}
                  </p>
                ) : null}
              </div>

              <div>
                <Label htmlFor="refund-nayax-resolution-occurred-at">
                  Evidence date and time ({resolution.action.form.timezone.value || 'timezone needed'})
                </Label>
                <Input
                  id="refund-nayax-resolution-occurred-at"
                  data-testid="refund-nayax-resolution-occurred-at"
                  type="datetime-local"
                  step={1}
                  value={resolution.action.form.occurredAt}
                  onChange={(event) => onOccurredAtChange(event.target.value)}
                  autoComplete="off"
                  className="mt-2 bg-background"
                />
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Use the exact date and time shown in Nayax, including seconds. This uses the
                  machine timezone shown above, not your computer&apos;s timezone. For confirmed
                  success, it is also used in reporting and the customer receipt.
                </p>
                {resolution.action.form.timezone.defaultMissing ? (
                  <p className="mt-2 text-xs font-medium text-destructive" role="alert">
                    This case is missing its machine timezone. Choose the timezone shown in Nayax below.
                  </p>
                ) : null}
                <details
                  className="mt-3 rounded-md border border-border/70 bg-muted/25 px-3 py-2"
                  data-testid="refund-nayax-resolution-timezone-override"
                >
                  <summary className="cursor-pointer text-xs font-medium text-foreground">
                    Use a different timezone
                  </summary>
                  <div className="mt-3">
                    <Label htmlFor="refund-nayax-resolution-timezone">Timezone shown by Nayax</Label>
                    <Input
                      id="refund-nayax-resolution-timezone"
                      data-testid="refund-nayax-resolution-timezone"
                      list="refund-nayax-resolution-timezones"
                      value={resolution.action.form.timezone.value}
                      onChange={(event) => onTimezoneChange(event.target.value)}
                      placeholder="America/Los_Angeles"
                      autoComplete="off"
                      className="mt-2 bg-background"
                    />
                    <datalist id="refund-nayax-resolution-timezones">
                      <option value="America/Los_Angeles" />
                      <option value="America/Denver" />
                      <option value="America/Chicago" />
                      <option value="America/New_York" />
                      <option value="America/Phoenix" />
                      <option value="Pacific/Honolulu" />
                      <option value="America/Anchorage" />
                      <option value="UTC" />
                    </datalist>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      Change this only when the Nayax record clearly shows a different timezone.
                    </p>
                  </div>
                </details>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-5 text-muted-foreground">
                  This records evidence for the System. It does not ask for or create another approval.
                </p>
                <Button
                  type="button"
                  data-testid="refund-nayax-resolution-prepare"
                  onClick={onPrepare}
                  disabled={resolution.action.form.submit.disabled}
                  className="min-h-11 shrink-0 bg-foreground text-background hover:bg-foreground/90"
                >
                  {resolution.action.form.submit.pending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {resolution.action.form.submit.label}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type RefundCardManagerStatePresentation = {
  label: string;
  explanation: string;
};

export type RefundCardManagerCapabilityAction =
  | { kind: 'hidden' }
  | { kind: 'empty' }
  | {
      kind: 'status';
      label: string;
      helper?: string | null;
    }
  | {
      kind: 'button';
      testId: 'refund-run-nayax-refund' | 'refund-save-case' | 'refund-approve-reviewed-purchase' | 'refund-approve-selected-purchase';
      label: string;
      disabled: boolean;
      pending: boolean;
    };

type RefundCardManagerDecisionPanelProps = {
  managerState: RefundCardManagerStatePresentation;
  managerNextStep: string;
  action: RefundCardManagerCapabilityAction;
  onPrimaryAction: () => void;
  purchase?: { amount: string; time: string | null; timeLabel: string; card: string | null } | null;
  onDeny?: (trigger: HTMLButtonElement) => void;
  denialDisabled?: boolean;
  refundAmount?: { value: string; maximum: string; error: string | null; onChange: (value: string) => void } | null;
};

export function RefundCardManagerDecisionPanel({
  managerState,
  managerNextStep,
  action,
  onPrimaryAction,
  purchase,
  onDeny,
  denialDisabled,
  refundAmount,
}: RefundCardManagerDecisionPanelProps) {
  return (
    <div
      data-testid="refund-primary-action"
      aria-live="polite"
      className="space-y-4 border-b border-border px-4 py-5"
    >
      <div>
        <h3 data-testid="refund-manager-state" className="text-xl font-semibold">
          {managerState.label}
        </h3>
        <p className="mt-2 max-w-xl text-sm leading-5 text-muted-foreground">
          {managerState.explanation}
        </p>
        <span data-testid="refund-manager-next-step" className="sr-only">{managerNextStep}</span>
      </div>
      {purchase && <dl data-testid="refund-recommended-purchase" className="grid gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-muted-foreground">Amount</dt><dd className="mt-1 font-semibold">{purchase.amount}</dd></div>
        {purchase.time && <div><dt className="text-muted-foreground">{purchase.timeLabel}</dt><dd className="mt-1 font-medium">{purchase.time}</dd></div>}
        {purchase.card && <div><dt className="text-muted-foreground">Nayax card</dt><dd className="mt-1 font-medium">{purchase.card}</dd></div>}
      </dl>}
      {action.kind !== 'hidden' && (
        <>
        {refundAmount && <div className="max-w-sm space-y-2">
          <Label htmlFor="manager-card-refund-amount">Refund amount (USD)</Label>
          <Input id="manager-card-refund-amount" inputMode="decimal" value={refundAmount.value}
            onChange={(event) => refundAmount.onChange(event.target.value)} aria-invalid={Boolean(refundAmount.error)}
            aria-describedby="manager-card-refund-amount-help" disabled={action.kind === 'button' && action.pending} />
          <p id="manager-card-refund-amount-help" className="text-sm leading-5 text-muted-foreground">Default is the full selected purchase. Refund only the affected portion when appropriate. Maximum: {refundAmount.maximum}.</p>
          {refundAmount.error && <p role="alert" className="text-sm text-destructive">{refundAmount.error}</p>}
        </div>}
        <div className="flex flex-wrap items-center gap-3">
          {action.kind === 'status' ? (
            <div
              data-testid="refund-action-status"
              role="status"
              aria-label={action.label}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-4 py-2 text-center text-sm font-semibold leading-5 text-orange-950 sm:w-auto"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <div>
                <p>{action.label}</p>
                {action.helper && (
                  <p className="mt-1 max-w-lg font-normal leading-5">{action.helper}</p>
                )}
              </div>
            </div>
          ) : action.kind === 'button' ? (
            <Button
              data-testid={action.testId}
              type="button"
              className="h-auto min-h-11 w-full whitespace-normal px-5 py-2.5 text-center font-semibold leading-5 sm:w-auto"
              onClick={onPrimaryAction}
              disabled={action.disabled}
            >
              {action.pending ? (
                <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4 shrink-0" />
              )}
              {action.label}
            </Button>
          ) : null}
          {onDeny && <Button data-testid="refund-deny-instead" type="button" variant="outline"
            className="min-h-11 px-5" disabled={denialDisabled} onClick={(event) => onDeny(event.currentTarget)}>Deny</Button>}
        </div>
        </>
      )}
    </div>
  );
}

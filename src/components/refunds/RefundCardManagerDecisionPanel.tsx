import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

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
};

export function RefundCardManagerDecisionPanel({
  managerState,
  managerNextStep,
  action,
  onPrimaryAction,
}: RefundCardManagerDecisionPanelProps) {
  return (
    <div
      data-testid="refund-primary-action"
      aria-live="polite"
      className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Current state
        </p>
        <h3 data-testid="refund-manager-state" className="mt-1 text-xl font-semibold">
          {managerState.label}
        </h3>
        <p className="mt-2 max-w-xl text-sm leading-5 text-muted-foreground">
          {managerState.explanation}
        </p>
        <p data-testid="refund-manager-next-step" className="mt-1 max-w-xl text-sm font-medium leading-5 text-foreground">
          Next: {managerNextStep}
        </p>
      </div>
      {action.kind !== 'hidden' && (
        <div className="flex flex-col gap-2 sm:items-end">
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
        </div>
      )}
    </div>
  );
}

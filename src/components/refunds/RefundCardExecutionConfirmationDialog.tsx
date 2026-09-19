import { CheckCircle2, Loader2 } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

export type RefundCardExecutionConfirmationPresentation = {
  title: string;
  machine: {
    label: string;
    location: string;
  };
  transaction: {
    timeLabel: string;
    time: string;
    payment: string;
    timezone: string;
    timeSourceDetail: string;
    timeMeaning: string;
    providerMachineClock: string | null;
  };
  customerDraft: {
    subject: string;
    body: string;
  } | null;
  executionNotice: {
    className: string;
    message: string;
  } | null;
  busy: boolean;
  confirmDisabled: boolean;
};

type RefundCardExecutionConfirmationDialogProps = {
  open: boolean;
  presentation: RefundCardExecutionConfirmationPresentation;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export function RefundCardExecutionConfirmationDialog({
  open,
  presentation,
  onOpenChange,
  onConfirm,
}: RefundCardExecutionConfirmationDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="refund-confirmation-dialog" className="max-w-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{presentation.title}</AlertDialogTitle>
          <AlertDialogDescription>
            This records your approval once. Bloomjoy will finish the refund automatically and email the customer only after Nayax confirms it.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Machine</p>
            <p className="mt-1 font-medium text-foreground">{presentation.machine.label}</p>
            <p className="mt-1 text-muted-foreground">{presentation.machine.location}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {presentation.transaction.timeLabel}
            </p>
            <p className="mt-1 font-medium text-foreground">{presentation.transaction.time}</p>
            <p className="mt-1 text-muted-foreground">{presentation.transaction.payment}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Shown in venue time · {presentation.transaction.timezone}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {presentation.transaction.timeSourceDetail}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {presentation.transaction.timeMeaning}
            </p>
            {presentation.transaction.providerMachineClock && (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Provider machine clock: {presentation.transaction.providerMachineClock}
              </p>
            )}
          </div>
        </div>

        {presentation.customerDraft && (
          <details className="rounded-lg border border-border p-3 text-sm">
            <summary className="cursor-pointer font-medium text-foreground">Review completion email</summary>
            <div className="mt-3 max-h-52 overflow-y-auto rounded-md bg-muted/30 p-3">
              <p className="font-medium text-foreground">{presentation.customerDraft.subject}</p>
              <p className="mt-2 whitespace-pre-line leading-6 text-muted-foreground">
                {presentation.customerDraft.body}
              </p>
            </div>
          </details>
        )}

        {presentation.executionNotice && (
          <div className={presentation.executionNotice.className}>
            {presentation.executionNotice.message}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={presentation.busy}>Go back</AlertDialogCancel>
          <Button
            data-testid="refund-confirm-nayax-refund"
            type="button"
            onClick={onConfirm}
            disabled={presentation.confirmDisabled}
            className="bg-foreground text-background hover:bg-foreground/90"
          >
            {presentation.busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            Approve refund
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

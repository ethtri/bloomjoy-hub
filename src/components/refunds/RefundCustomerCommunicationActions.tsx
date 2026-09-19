import { Button } from '@/components/ui/button';

export type RefundCustomerCommunicationActionsPresentation = {
  draft: {
    subject: string;
    body: string;
  } | null;
  requestCorrection: {
    disabled: boolean;
  } | null;
  denial: {
    label: string;
    disabled: boolean;
  } | null;
};

type RefundCustomerCommunicationActionsProps = {
  presentation: RefundCustomerCommunicationActionsPresentation;
  onRequestCorrection: () => void;
  onDeny: (trigger: HTMLButtonElement) => void;
};

export function RefundCustomerCommunicationActions({
  presentation,
  onRequestCorrection,
  onDeny,
}: RefundCustomerCommunicationActionsProps) {
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-foreground">Preview customer email</summary>
        {presentation.draft ? (
          <div className="mt-3 max-w-xl rounded-md bg-muted/40 p-3">
            <p className="font-medium text-foreground">{presentation.draft.subject}</p>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">
              {presentation.draft.body}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-muted-foreground">No automatic email is queued for this state.</p>
        )}
      </details>
      <details className="text-sm sm:text-right">
        <summary className="cursor-pointer font-medium text-muted-foreground">Other decisions</summary>
        <div className="mt-3 flex flex-wrap gap-2 sm:justify-end">
          {presentation.requestCorrection && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={presentation.requestCorrection.disabled}
              onClick={onRequestCorrection}
            >
              Request customer correction
            </Button>
          )}
          {presentation.denial && (
            <Button
              data-testid="refund-deny-instead"
              type="button"
              size="sm"
              variant="outline"
              disabled={presentation.denial.disabled}
              onClick={(event) => onDeny(event.currentTarget)}
            >
              {presentation.denial.label}
            </Button>
          )}
        </div>
      </details>
    </div>
  );
}

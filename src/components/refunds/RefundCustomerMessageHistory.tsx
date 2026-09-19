import type { Ref } from 'react';
import { Mail } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type RefundCustomerMessageHistoryRow = {
  id: string;
  focused: boolean;
  focusedAriaLabel: string | null;
  messageTypeLabel: string;
  primaryBadge:
    | { kind: 'completion'; label: string }
    | { kind: 'status'; label: string; className: string };
  deliveryBadge: {
    testId: string;
    label: string;
    className: string;
  } | null;
  deliveryKindLabel: string | null;
  details: {
    heading: string;
    requestedFields: string | null;
    templateVersion: string | null;
  } | null;
  subject: string;
  body: string;
  recipientEmail: string;
  recordedLabel: string;
  errorMessage: string | null;
};

type RefundCustomerMessageHistoryProps = {
  rows: RefundCustomerMessageHistoryRow[];
  detailsRef: Ref<HTMLDetailsElement>;
  summaryRef: Ref<HTMLElement>;
  focusedRecordRef: Ref<HTMLDivElement>;
};

export function RefundCustomerMessageHistory({
  rows,
  detailsRef,
  summaryRef,
  focusedRecordRef,
}: RefundCustomerMessageHistoryProps) {
  return (
    <details
      ref={detailsRef}
      data-testid="refund-customer-messages"
      className="rounded-lg border border-border bg-background p-3"
    >
      <summary
        ref={summaryRef}
        data-testid="refund-customer-messages-summary"
        className="flex scroll-mt-20 cursor-pointer list-none items-center gap-2 rounded-sm text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Mail className="h-4 w-4 text-primary" />
        Customer messages ({rows.length})
      </summary>
      <div className="mt-3 space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No customer email records have been logged.</p>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              ref={row.focused ? focusedRecordRef : undefined}
              data-refund-message-id={row.id}
              data-testid={row.focused ? 'refund-focused-delivery-record' : undefined}
              tabIndex={row.focused ? -1 : undefined}
              aria-label={row.focused ? row.focusedAriaLabel ?? undefined : undefined}
              className={cn(
                'rounded-md border border-border/80 p-2',
                row.focused && 'scroll-mt-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="capitalize">{row.messageTypeLabel}</Badge>
                {row.primaryBadge.kind === 'completion' ? (
                  <Badge variant="secondary">{row.primaryBadge.label}</Badge>
                ) : (
                  <Badge className={cn('capitalize', row.primaryBadge.className)}>
                    {row.primaryBadge.label}
                  </Badge>
                )}
                {row.deliveryBadge && (
                  <Badge
                    data-testid={row.deliveryBadge.testId}
                    variant="outline"
                    className={row.deliveryBadge.className}
                  >
                    {row.deliveryBadge.label}
                  </Badge>
                )}
                {row.deliveryKindLabel && (
                  <Badge variant="secondary" className="capitalize">{row.deliveryKindLabel}</Badge>
                )}
              </div>
              {row.details && (
                <div className="mt-2 rounded-md border border-sky-200 bg-sky-50 p-2 text-xs leading-5 text-sky-950">
                  <p className="font-medium">{row.details.heading}</p>
                  {row.details.requestedFields && <p>Requested: {row.details.requestedFields}</p>}
                  {row.details.templateVersion && <p>Template: {row.details.templateVersion}</p>}
                </div>
              )}
              <p className="mt-2 break-words text-sm font-medium text-foreground">{row.subject}</p>
              <p className="mt-2 whitespace-pre-line break-words rounded-md bg-muted/40 p-2 text-xs leading-5 text-muted-foreground">
                {row.body}
              </p>
              <p className="mt-1 break-words text-xs text-muted-foreground">
                To {row.recipientEmail} / {row.recordedLabel}
              </p>
              {row.errorMessage && (
                <p className="mt-1 break-words text-xs text-destructive">{row.errorMessage}</p>
              )}
            </div>
          ))
        )}
      </div>
    </details>
  );
}

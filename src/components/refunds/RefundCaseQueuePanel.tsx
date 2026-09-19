import { ArrowLeft } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { formatRefundMachineLocation } from '@/lib/refundMachineLabel';
import type { RefundCaseRecord } from '@/lib/refundOperations';
import { getRefundManagerQueueBucket } from '@/lib/refundQueue';
import { cn } from '@/lib/utils';

type RefundCaseQueuePanelProps = {
  cases: RefundCaseRecord[];
  selectedCaseId: string | null;
  hasSelectedCase: boolean;
  isMobileExpanded: boolean;
  isLoading: boolean;
  isSearching: boolean;
  emptyTitle: string;
  emptyDescription: string;
  onToggleMobile: () => void;
  onSelectCase: (refundCase: RefundCaseRecord) => void;
  getTaskLabel: (refundCase: RefundCaseRecord) => string;
  getTaskBadgeClass: (refundCase: RefundCaseRecord) => string;
  getIntakeSourceLabel: (refundCase: RefundCaseRecord) => string;
  getIntakeSourceBadgeClass: (refundCase: RefundCaseRecord) => string;
  formatCaseAge: (createdAt: string | null) => string;
  formatCaseAmount: (cents: number | null) => string;
};

const refundSearchViewLabel = (refundCase: RefundCaseRecord) => ({
  needs_action: 'Action needed',
  ready_to_pay: 'Ready to approve',
  in_progress: 'Refund in progress',
  waiting_on_customer: 'Waiting for customer',
  provider_hold: 'Check Nayax refund status',
  accounting_review: 'Fix refund accounting',
  integrity_hold: 'Fix payment record',
  completed: 'Done',
  internal_archive: 'Internal/test archive',
})[getRefundManagerQueueBucket(refundCase)];

type RefundCaseQueueItemProps = {
  refundCase: RefundCaseRecord;
  isSelected: boolean;
  isSearching: boolean;
  onSelect: () => void;
  taskLabel: string;
  taskBadgeClass: string;
  intakeSourceLabel: string;
  intakeSourceBadgeClass: string;
  amountLabel: string;
  ageLabel: string;
};

function RefundCaseQueueItem({
  refundCase,
  isSelected,
  isSearching,
  onSelect,
  taskLabel,
  taskBadgeClass,
  intakeSourceLabel,
  intakeSourceBadgeClass,
  amountLabel,
  ageLabel,
}: RefundCaseQueueItemProps) {
  return (
    <button
      data-testid="refund-case-queue-item"
      type="button"
      aria-current={isSelected ? 'true' : undefined}
      onClick={onSelect}
      className={cn(
        'block w-full min-w-0 p-4 text-left transition-colors hover:bg-muted/40 lg:min-h-20 lg:px-4 lg:py-3 lg:focus-visible:outline-none lg:focus-visible:ring-2 lg:focus-visible:ring-inset lg:focus-visible:ring-ring',
        isSelected && 'bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]'
      )}
    >
      <div className="grid min-w-0 gap-2 lg:flex lg:items-start lg:justify-between lg:gap-3">
        <div className="contents min-w-0 lg:block">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="break-words text-sm font-semibold text-foreground lg:truncate">
              {refundCase.publicReference}
            </span>
            <Badge
              variant="outline"
              data-testid="refund-case-source"
              className={cn(
                'shrink-0 px-1.5 py-0 text-[10px] font-semibold',
                intakeSourceBadgeClass
              )}
            >
              {intakeSourceLabel}
            </Badge>
          </div>
          <p className="order-3 text-xs text-muted-foreground lg:mt-1 lg:truncate">
            {formatRefundMachineLocation(refundCase.locationName, refundCase.machineLabel)}
          </p>
        </div>
        <Badge
          className={cn(
            'order-2 h-auto w-fit max-w-full whitespace-normal break-words rounded-md py-1 text-left leading-tight lg:order-none lg:max-w-none lg:shrink-0 lg:whitespace-nowrap lg:break-normal lg:py-0.5 lg:text-center lg:leading-none',
            taskBadgeClass
          )}
        >
          {taskLabel}
        </Badge>
      </div>
      {isSearching && (
        <p className="mt-2 text-xs text-muted-foreground">
          Current view: {refundSearchViewLabel(refundCase)}
        </p>
      )}
      <div className="mt-3 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-foreground">
          {amountLabel}
        </span>
        <span className="text-muted-foreground">{ageLabel} old</span>
      </div>
    </button>
  );
}

export function RefundCaseQueuePanel({
  cases,
  selectedCaseId,
  hasSelectedCase,
  isMobileExpanded,
  isLoading,
  isSearching,
  emptyTitle,
  emptyDescription,
  onToggleMobile,
  onSelectCase,
  getTaskLabel,
  getTaskBadgeClass,
  getIntakeSourceLabel,
  getIntakeSourceBadgeClass,
  formatCaseAge,
  formatCaseAmount,
}: RefundCaseQueuePanelProps) {
  const renderContents = (showCases: boolean) => {
    if (isLoading) {
      return (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">
          Loading refund queue...
        </div>
      );
    }
    if (cases.length === 0) {
      return (
        <div className="px-4 py-10 text-center">
          <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            {emptyDescription}
          </p>
        </div>
      );
    }
    if (!showCases) return null;
    return cases.map((refundCase) => (
      <RefundCaseQueueItem
        key={refundCase.id}
        refundCase={refundCase}
        isSelected={refundCase.id === selectedCaseId}
        isSearching={isSearching}
        onSelect={() => onSelectCase(refundCase)}
        taskLabel={getTaskLabel(refundCase)}
        taskBadgeClass={getTaskBadgeClass(refundCase)}
        intakeSourceLabel={getIntakeSourceLabel(refundCase)}
        intakeSourceBadgeClass={getIntakeSourceBadgeClass(refundCase)}
        amountLabel={formatCaseAmount(
          refundCase.refundAmountCents ?? refundCase.paymentAmountCents
        )}
        ageLabel={formatCaseAge(refundCase.createdAt)}
      />
    ));
  };

  return (
    <div
      id="refund-queue-panel"
      tabIndex={-1}
      className={cn(
        'scroll-mt-20 min-w-0 overflow-hidden rounded-xl border border-border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring lg:sticky lg:top-4 lg:flex lg:h-[calc(100dvh-15rem)] lg:min-h-[28rem] lg:max-h-[52rem] lg:flex-col',
        hasSelectedCase && !isMobileExpanded && 'hidden lg:flex'
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {isSearching ? 'Search results' : 'Queue'}
          </h2>
          <p
            data-testid="refund-queue-count"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="mt-1 text-xs text-muted-foreground"
          >
            {cases.length} {cases.length === 1 ? 'case' : 'cases'}
          </p>
        </div>
        {hasSelectedCase && (
          <button
            type="button"
            aria-expanded={isMobileExpanded}
            aria-label={isMobileExpanded ? 'Hide queue' : 'Show queue'}
            onClick={onToggleMobile}
            className="flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:hidden"
          >
            {!isMobileExpanded && <ArrowLeft className="h-4 w-4" aria-hidden="true" />}
            {isMobileExpanded ? 'Hide queue' : 'Back to queue'}
          </button>
        )}
      </div>

      <div className="divide-y divide-border/70 lg:hidden">
        {renderContents(isMobileExpanded || !hasSelectedCase)}
      </div>

      <div
        role="region"
        aria-label="Refund case queue"
        tabIndex={0}
        className="hidden min-h-0 flex-1 divide-y divide-border/70 overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:block"
      >
        {renderContents(true)}
      </div>
    </div>
  );
}

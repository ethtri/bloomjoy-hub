import { ArrowLeft } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { formatRefundMachineLocation } from '@/lib/refundMachineLabel';
import { cn } from '@/lib/utils';

export type RefundCaseQueueListItem = {
  id: string;
  publicReference: string;
  machineLabel: string;
  locationName: string;
  amountCents: number | null;
  createdAt: string | null;
  taskLabel: string;
  taskBadgeClass: string;
  nextWorkActor: 'agent' | 'customer' | 'manager' | 'system' | null;
  nextWorkActionLabel: string | null;
};

type RefundCaseQueuePanelProps = {
  cases: RefundCaseQueueListItem[];
  viewTitle?: string;
  showWorkflowSummary?: boolean;
  selectedCaseId: string | null;
  hasSelectedCase: boolean;
  isMobileExpanded: boolean;
  isLoading: boolean;
  isUnavailable?: boolean;
  isSearching: boolean;
  emptyTitle: string;
  emptyDescription: string;
  onToggleMobile: () => void;
  onSelectCase: (caseId: string) => void;
  formatCaseAge: (createdAt: string | null) => string;
  formatCaseAmount: (cents: number | null) => string;
};

type RefundCaseQueueItemProps = {
  refundCase: RefundCaseQueueListItem;
  showWorkflowSummary: boolean;
  isSelected: boolean;
  onSelect: () => void;
  taskLabel: string;
  taskBadgeClass: string;
  amountLabel: string;
  ageLabel: string;
};

function RefundCaseQueueItem({
  refundCase,
  showWorkflowSummary,
  isSelected,
  onSelect,
  taskLabel,
  taskBadgeClass,
  amountLabel,
  ageLabel,
}: RefundCaseQueueItemProps) {
  const nextOwner = refundCase.nextWorkActor === 'manager' ? 'Manager'
    : refundCase.nextWorkActor === 'customer' ? 'Customer' : 'Bloomjoy';
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
      {showWorkflowSummary && (
        <div data-testid="refund-case-next-work" className="mt-2 space-y-1 text-xs leading-relaxed text-muted-foreground">
          {!refundCase.nextWorkActor || !refundCase.nextWorkActionLabel ? (
            <p>Status unavailable. Refresh to check who acts next.</p>
          ) : (
            <p><span className="font-semibold text-foreground">{nextOwner} next:</span> {refundCase.nextWorkActionLabel}</p>
          )}

        </div>
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
  viewTitle,
  showWorkflowSummary = false,
  selectedCaseId,
  hasSelectedCase,
  isMobileExpanded,
  isLoading,
  isUnavailable = false,
  isSearching,
  emptyTitle,
  emptyDescription,
  onToggleMobile,
  onSelectCase,
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
        showWorkflowSummary={showWorkflowSummary}
        isSelected={refundCase.id === selectedCaseId}
        onSelect={() => onSelectCase(refundCase.id)}
        taskLabel={refundCase.taskLabel}
        taskBadgeClass={refundCase.taskBadgeClass}
        amountLabel={formatCaseAmount(
          refundCase.amountCents
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
            {isSearching ? 'Search results' : viewTitle ?? 'Queue'}
          </h2>
          <p
            data-testid="refund-queue-count"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="mt-1 text-xs text-muted-foreground"
          >
            {isUnavailable ? 'Case list unavailable' :
              `${cases.length} ${cases.length === 1 ? 'case' : 'cases'}`}
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

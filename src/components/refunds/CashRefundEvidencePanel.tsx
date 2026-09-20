import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock3, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  fetchRefundSunzeCashCorrelation,
  refundSunzeCashSelectionPendingQueryKey,
  selectRefundSunzeCashCandidate,
} from '@/lib/refundSunzeCashCorrelationApi';
import type {
  RefundSunzeCashCandidate,
  RefundSunzeCashCorrelation,
  RefundSunzeCashSelectedSale,
  RefundSunzeCashSelectionPending,
} from '@/lib/refundSunzeCashCorrelation';
import {
  refundSunzeCashSelectionOperationOwnsMarker,
  refundSunzeCashSelectionRefreshIsAuthoritative,
} from '@/lib/refundSunzeCashCorrelation';
import type { RefundCaseRecord } from '@/lib/refundOperations';
import { formatRefundDateTime } from '@/lib/refundTimePresentation';
import { cn } from '@/lib/utils';

type CashRefundEvidencePanelProps = {
  refundCase: RefundCaseRecord;
  isUsingDemoData: boolean;
  venueTimezone: string | null;
  isCompleted?: boolean;
};

const formatCurrency = (amountCents: number | null | undefined) =>
  typeof amountCents === 'number'
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amountCents / 100)
    : 'Not provided';

const formatSaleTime = (value: string, venueTimezone: string | null) =>
  formatRefundDateTime(value, venueTimezone);

const evidenceStateCopy: Record<RefundSunzeCashCorrelation['state'], {
  label: string;
  detail: string;
  tone: 'neutral' | 'success' | 'warning';
}> = {
  checking_sales_history: {
    label: 'Checking sales history',
    detail: 'Bloomjoy is waiting for a complete sales-history window. You may continue with other reviewed evidence while it checks.',
    tone: 'neutral',
  },
  sale_found: {
    label: 'Sale found',
    detail: 'One supported Sunze sale is shown as evidence. The amount and details below do not make the refund decision for you.',
    tone: 'success',
  },
  multiple_possible_sales: {
    label: 'Multiple sales to review',
    detail: 'Choose the sale that best matches the customer request, or continue with your own investigation. Choosing evidence is not a second approval.',
    tone: 'warning',
  },
  no_sale_found_with_complete_coverage: {
    label: 'No sale found',
    detail: 'No supported Sunze sale was found in the fully covered window. Continue with additional investigation or other reviewed evidence if appropriate.',
    tone: 'neutral',
  },
  sales_history_unavailable: {
    label: 'Sales history unavailable',
    detail: 'The sales-history source is stale, incomplete, or not validated for this request. Continue with additional investigation or other reviewed evidence if appropriate.',
    tone: 'warning',
  },
};

const SaleDetails = ({
  sale,
  heading,
  venueTimezone,
}: {
  sale: RefundSunzeCashCandidate | RefundSunzeCashSelectedSale;
  heading: string;
  venueTimezone: string | null;
}) => (
  <div className="rounded-lg border border-border bg-background p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <p className="text-sm font-semibold text-foreground">{heading}</p>
      <p className="text-sm font-semibold text-foreground">{formatCurrency(sale.actualAmountCents)}</p>
    </div>
    <dl className="mt-3 grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
      <div>
        <dt>Sale time (venue time)</dt>
        <dd className="mt-1 font-medium text-foreground">{formatSaleTime(sale.paymentTime, venueTimezone)}</dd>
        <dd className="mt-1 text-[11px] leading-4 text-muted-foreground">
          {venueTimezone ? `Shown in venue time · ${venueTimezone}` : 'Venue time unavailable'}
        </dd>
      </div>
      <div>
        <dt>Machine</dt>
        <dd className="mt-1 font-medium text-foreground">{sale.machineLabel ?? 'Not available'}</dd>
      </div>
      <div>
        <dt>Location</dt>
        <dd className="mt-1 font-medium text-foreground">{sale.locationName ?? 'Not available'}</dd>
      </div>
      <div>
        <dt>Product</dt>
        <dd className="mt-1 font-medium text-foreground">{sale.tradeLabel ?? 'Not available'}</dd>
      </div>
    </dl>
  </div>
);

export function CashRefundEvidencePanel({
  refundCase,
  isUsingDemoData,
  venueTimezone,
  isCompleted = false,
}: CashRefundEvidencePanelProps) {
  const queryClient = useQueryClient();
  const correlationQueryKey = ['refund-sunze-cash-correlation', refundCase.id] as const;
  const selectionPendingQueryKey = refundSunzeCashSelectionPendingQueryKey(refundCase.id);
  const { data: selectionPending = null } = useQuery<RefundSunzeCashSelectionPending | null>({
    queryKey: selectionPendingQueryKey,
    queryFn: async () => null,
    enabled: false,
    placeholderData: null,
    gcTime: Infinity,
  });
  const isSelectionPending = selectionPending !== null;
  const query = useQuery({
    queryKey: correlationQueryKey,
    queryFn: ({ signal }) => fetchRefundSunzeCashCorrelation(refundCase.id, signal),
    enabled: !isUsingDemoData,
    staleTime: 10_000,
    retry: false,
    refetchOnMount: selectionPending?.recoveryAvailable ? 'always' : true,
  });
  const correlation = isUsingDemoData
    ? refundCase.sunzeCashCorrelation ?? null
    : query.data ?? null;
  const state = correlation?.state ?? (query.isError ? 'sales_history_unavailable' : 'checking_sales_history');
  const copy = evidenceStateCopy[state];
  const candidates = correlation?.candidates ?? [];
  const selectedId = correlation?.selectedSalesFactId ?? null;
  const selectedSale = correlation?.selectedSale ?? (
    selectedId ? candidates.find((candidate) => candidate.salesFactId === selectedId) ?? null : null
  );

  useEffect(() => {
    if (refundSunzeCashSelectionRefreshIsAuthoritative(
      selectionPending,
      query.dataUpdatedAt,
      query.isSuccess && Boolean(query.data),
    )) {
      queryClient.setQueryData<RefundSunzeCashSelectionPending | null>(selectionPendingQueryKey, (current) =>
        refundSunzeCashSelectionOperationOwnsMarker(current, selectionPending.operationId)
          ? null
          : current ?? null
      );
    }
  }, [query.data, query.dataUpdatedAt, query.isSuccess, queryClient, selectionPending, selectionPendingQueryKey]);

  const handleSelect = async (candidate: RefundSunzeCashCandidate) => {
    const activeSelection = queryClient.getQueryData<RefundSunzeCashSelectionPending | null>(selectionPendingQueryKey);
    if (!correlation?.attemptId || candidate.selectionConflict || isUsingDemoData || activeSelection) return;
    const pendingMarker: RefundSunzeCashSelectionPending = {
      operationId: crypto.randomUUID(),
      afterDataUpdatedAt: query.dataUpdatedAt,
      recoveryAvailable: false,
    };
    queryClient.setQueryData(selectionPendingQueryKey, pendingMarker);
    try {
      const selection = await selectRefundSunzeCashCandidate({
        caseId: refundCase.id,
        attemptId: correlation.attemptId,
        salesFactId: candidate.salesFactId,
        caseFactVersion: correlation.caseFactVersion,
        expectedLinkVersion: correlation.expectedLinkVersion,
      });
      queryClient.setQueryData<RefundSunzeCashCorrelation>(correlationQueryKey, (current) => {
        if (!current || current.caseFactVersion !== correlation.caseFactVersion) return current;
        return {
          ...current,
          selectedSalesFactId: selection.salesFactId,
          selectedLinkVersion: selection.linkVersion,
          expectedLinkVersion: selection.linkVersion,
          selectedSale: {
            salesFactId: candidate.salesFactId,
            paymentTime: candidate.paymentTime,
            actualAmountCents: candidate.actualAmountCents,
            machineLabel: candidate.machineLabel,
            locationName: candidate.locationName,
            tradeLabel: candidate.tradeLabel,
          },
        };
      });
      await queryClient.invalidateQueries({ queryKey: correlationQueryKey });
      queryClient.setQueryData<RefundSunzeCashSelectionPending | null>(selectionPendingQueryKey, (current) =>
        refundSunzeCashSelectionOperationOwnsMarker(current, pendingMarker.operationId)
          ? null
          : current ?? null
      );
      toast.success('Sale evidence selected for review.');
    } catch (error) {
      const refreshed = await query.refetch();
      if (refreshed.isSuccess && refreshed.data) {
        queryClient.setQueryData<RefundSunzeCashSelectionPending | null>(selectionPendingQueryKey, (current) =>
          refundSunzeCashSelectionOperationOwnsMarker(current, pendingMarker.operationId)
            ? null
            : current ?? null
        );
      } else {
        queryClient.setQueryData<RefundSunzeCashSelectionPending | null>(selectionPendingQueryKey, (current) =>
          refundSunzeCashSelectionOperationOwnsMarker(current, pendingMarker.operationId)
            ? { ...current, recoveryAvailable: true }
            : current ?? null
        );
      }
      toast.error(error instanceof Error ? error.message : 'The sale evidence could not be selected. Refresh and try again.');
    }
  };

  const handleRefresh = async () => {
    const pendingMarker = queryClient.getQueryData<RefundSunzeCashSelectionPending | null>(selectionPendingQueryKey);
    const refreshed = await query.refetch();
    if (refreshed.isSuccess && refreshed.data && pendingMarker) {
      queryClient.setQueryData<RefundSunzeCashSelectionPending | null>(selectionPendingQueryKey, (current) =>
        refundSunzeCashSelectionOperationOwnsMarker(current, pendingMarker.operationId)
          ? null
          : current ?? null
      );
    }
  };

  return (
    <article data-testid="refund-cash-match-summary" className="border-t border-border bg-muted/20 p-4 lg:border-t-0">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cash review</p>
          <p className="mt-2 text-lg font-semibold text-foreground">Sunze sales evidence</p>
        </div>
        <Badge
          data-testid="refund-cash-evidence-state"
          className={cn(
            'border-border bg-background text-foreground',
            copy.tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
            copy.tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-950',
          )}
        >
          {query.isFetching && !correlation ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
          {copy.label}
        </Badge>
      </div>

      <p data-testid="refund-cash-evidence-detail" className="mt-3 text-sm leading-6 text-muted-foreground">
        {copy.detail}
      </p>

      {(query.isError || selectionPending?.recoveryAvailable) && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{isSelectionPending
            ? 'The sale selection outcome could not be refreshed. Cash confirmation stays unavailable until the selected sale is current.'
            : 'Sales history could not be refreshed. The manager decision remains available from the reviewed case details.'}</span>
          <Button type="button" variant="ghost" size="sm" className="ml-auto min-h-8 shrink-0 px-2" disabled={query.isFetching} onClick={() => void handleRefresh()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      )}

      {selectedSale && (
        <div className="mt-3 space-y-2">
          <SaleDetails sale={selectedSale} heading="Selected sale evidence" venueTimezone={venueTimezone} />
          <p className="text-xs text-muted-foreground">
            Customer estimate: <span className="font-medium text-foreground">{formatCurrency(refundCase.paymentAmountCents)}</span> · Supported sale: <span className="font-medium text-foreground">{formatCurrency(selectedSale.actualAmountCents)}</span>. The final completion amount is derived from this selected sale on the server.
          </p>
        </div>
      )}

      {state === 'multiple_possible_sales' && candidates.length > 0 && (
        <fieldset className="mt-3 space-y-2" aria-label="Possible Sunze sales">
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Possible sales</legend>
          {candidates.map((candidate) => {
            const isSelected = selectedId === candidate.salesFactId;
            return (
              <label
                key={candidate.salesFactId}
                className={cn(
                  'flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border bg-background p-3 transition-colors',
                  isSelected && 'border-foreground ring-1 ring-foreground',
                  candidate.selectionConflict && 'cursor-not-allowed opacity-60',
                )}
              >
                <input
                  type="radio"
                  name={`sunze-cash-sale-${refundCase.id}`}
                  checked={isSelected}
                  disabled={candidate.selectionConflict || !correlation?.attemptId || isUsingDemoData || query.isFetching || isSelectionPending}
                  onChange={() => void handleSelect(candidate)}
                  className="mt-1 h-4 w-4 accent-foreground"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold text-foreground">
                    <span>Sale option {candidate.rank}</span>
                    <span>{formatCurrency(candidate.actualAmountCents)}</span>
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    {formatSaleTime(candidate.paymentTime, venueTimezone)} · {candidate.machineLabel ?? 'Machine unavailable'} · {candidate.locationName ?? 'Location unavailable'}
                  </span>
                  {candidate.tradeLabel && <span className="mt-1 block text-xs text-muted-foreground">Product: {candidate.tradeLabel}</span>}
                </span>
              </label>
            );
          })}
        </fieldset>
      )}

      {!selectedSale && state === 'sale_found' && candidates[0] && (
        <div className="mt-3 space-y-2">
          <SaleDetails sale={candidates[0]} heading="Supported sale" venueTimezone={venueTimezone} />
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
            This evidence is preselected when safe. It supports review but does not approve or deny the refund.
          </p>
        </div>
      )}

      <div className="mt-4 border-t border-border pt-3 text-sm">
        <p className="flex items-center gap-2 text-xs font-medium text-foreground"><Clock3 className="h-3.5 w-3.5" /> {isCompleted ? 'Cash refund recorded' : 'External refund only'}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {isSelectionPending
            ? 'Wait until the current selected sale and amount are confirmed. Do not send the external payment yet.'
            : isCompleted
            ? 'The external reimbursement and case completion are recorded. No further payment action is needed.'
            : 'Send the refund through Zelle outside Bloomjoy Hub first. Then select “Confirm refund sent via Zelle” here. Bloomjoy Hub records that confirmation; it does not send or verify the payment.'}
        </p>
      </div>
    </article>
  );
}

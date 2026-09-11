import { Clock3, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { refundManagerNextActionCopy, refundManagerWorkBuckets, type RefundManagerWorkBucket, type RefundManagerWorkProjection } from '@/lib/refundManagerWork';

const labels: Record<RefundManagerWorkBucket, string> = { needs_action: 'Action needed', ready_to_pay: 'Ready to refund', in_progress: 'In progress', provider_hold: 'Needs Refund Operations', waiting_on_customer: 'Waiting', completed: 'Done' };
const age = (minutes: number | null) => minutes === null ? 'None waiting' : minutes < 60 ? `${minutes}m old` : minutes < 2880 ? `${Math.floor(minutes / 60)}h old` : `${Math.floor(minutes / 1440)}d old`;

export function RefundManagerWorkSummary({ projection, onSelectCase, onSelectBucket }: { projection: RefundManagerWorkProjection; onSelectCase: (caseId: string) => void; onSelectBucket: (bucket: RefundManagerWorkBucket) => void }) {
  const activeItems = projection.items.filter((item) => item.queueBucket !== 'completed');
  return <section aria-labelledby="refund-manager-work-title" data-testid="refund-manager-work-summary" className="mt-4 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
    <div className="flex flex-col gap-3 border-b border-border bg-gradient-to-r from-sky-50/80 via-card to-card px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-800">Daily focus</p><h2 id="refund-manager-work-title" className="mt-1 text-lg font-semibold text-foreground">My refund work</h2><p className="mt-1 text-sm text-muted-foreground">Current assignments, ordered by the server-owned urgency and age.</p></div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground" role="status" aria-live="polite"><span className="inline-flex items-center gap-1.5"><Clock3 className="h-4 w-4" aria-hidden="true" />Oldest: {age(projection.oldestActionableAgeMinutes)}</span><span>{projection.recentMaterialChangeCount} changed in 24h</span></div>
    </div>
    <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6" aria-label="My refund work counts">
      {refundManagerWorkBuckets.map((bucket) => <button key={bucket} type="button" onClick={() => onSelectBucket(bucket)} className="min-h-20 bg-card px-3 py-3 text-left hover:bg-muted/40 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-label={`My refund work bucket ${bucket.replaceAll('_', ' ')}: ${projection.bucketCounts[bucket]}`}><span className="block text-xl font-semibold tabular-nums text-foreground">{projection.bucketCounts[bucket]}</span><span className="mt-1 block text-xs leading-4 text-muted-foreground">{labels[bucket]}</span></button>)}
    </div>
    <div className="px-4 py-4 sm:px-5">
      {activeItems.length === 0 ? <div className="py-4 text-center"><p className="font-medium text-foreground">You’re caught up.</p><p className="mt-1 text-sm text-muted-foreground">No assigned refund work needs attention right now.</p></div> : <><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold text-foreground">Prioritized work</h3><span className="text-xs text-muted-foreground">Top {Math.min(activeItems.length, 5)} of {activeItems.length}</span></div><ol className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {activeItems.slice(0, 5).map((item) => <li key={item.caseId}><Button type="button" variant="outline" onClick={() => onSelectCase(item.caseId)} className="h-auto min-h-11 w-full items-start justify-between gap-3 whitespace-normal p-3 text-left"><span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><span className="font-semibold text-foreground">{item.publicReference}</span>{item.urgentNoticeState === 'immediate_unresolved' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">Urgent notice unresolved</span>}</span><span className="mt-1 block text-xs text-muted-foreground">{item.machineLabel} · {item.locationName} · {age(item.ageMinutes)}</span><span className={cn('mt-2 block text-sm leading-5 text-foreground', ['in_progress', 'waiting_on_customer'].includes(item.queueBucket) && 'text-muted-foreground')}>{refundManagerNextActionCopy(item.actionCode)}</span><span className="mt-1 block text-xs leading-4 text-muted-foreground">{item.whatChanged}</span></span><ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /></Button></li>)}
      </ol></>}
    </div>
  </section>;
}

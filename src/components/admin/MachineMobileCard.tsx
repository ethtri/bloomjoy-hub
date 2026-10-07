import { type ReactNode, useId } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type MachineMobileCardProps = {
  name: string;
  state: string;
  company: string;
  platform: string;
  readerStatus?: string;
  refundStatus?: string;
  lastTransaction: string;
  managerCount?: number;
  attention?: string;
  sourceKey: string;
  highlighted?: boolean;
  canManage?: boolean;
  manageDisabled?: boolean;
  onManage: () => void;
  children: ReactNode;
};

/** A compact scan/manage view. Exact identities and history stay in the disclosure. */
export function MachineMobileCard({
  name, state, company, platform, readerStatus, refundStatus, lastTransaction, managerCount,
  attention, sourceKey, highlighted, canManage = true, manageDisabled, onManage, children,
}: MachineMobileCardProps) {
  const nameId = useId();
  return (
    <div role="row" data-source-key={sourceKey} className={cn('px-4 py-4 text-sm sm:hidden', highlighted && 'bg-primary/5')}>
      <div role="cell">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p id={nameId} className="break-words font-semibold leading-5 text-foreground">{name}</p>
            <p className="mt-1 break-words text-sm text-muted-foreground">{company}</p>
          </div>
          {canManage && (
            <Button variant="outline" className="min-h-11 shrink-0 px-3" onClick={onManage} disabled={manageDisabled} aria-describedby={nameId}>
              Manage <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant="outline"><span className="sr-only">State: </span>{state}</Badge>
          <span className="text-xs text-muted-foreground">{platform}</span>
          {managerCount !== undefined && <span className="text-xs text-muted-foreground">· {managerCount} {managerCount === 1 ? 'manager' : 'managers'}</span>}
        </div>
        {readerStatus && <p className="mt-2 text-xs text-muted-foreground">Reader: <span className="font-medium text-foreground">{readerStatus}</span></p>}
        {refundStatus && <p className="mt-1 text-xs text-muted-foreground">Refunds: <span className="font-medium text-foreground">{refundStatus}</span></p>}
        <p className="mt-1 text-xs text-muted-foreground">Last recorded transaction: <span className="text-foreground">{lastTransaction}</span></p>
        {attention && <p className="mt-2 break-words text-xs text-amber-800">{attention}</p>}
        <details className="group mt-2">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            Source &amp; details
            <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-3 border-t border-border pt-3 [&_*]:break-words">{children}</div>
        </details>
      </div>
    </div>
  );
}

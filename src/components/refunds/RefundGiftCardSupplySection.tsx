import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { supabaseClient } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { giftCardAmount } from '@/lib/refundGiftCard';
import { requireRefundGiftCardSupply, refundGiftCardSupplyStatus, type RefundGiftCardSupplyPool } from '@/lib/refundGiftCardSupply';

function StockSettings({ pool, onSaved }: { pool: RefundGiftCardSupplyPool; onSaved: () => Promise<unknown> }) {
  const { isSuperAdmin, isAuthenticated } = useAuth();
  const [minimum, setMinimum] = useState(String(pool.minAvailable ?? ''));
  const [target, setTarget] = useState(String(pool.targetAvailable ?? ''));
  const [batch, setBatch] = useState(String(pool.maxBatchSize ?? ''));
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const valid = [minimum, target, batch].every((item) => /^\d+$/.test(item)) &&
    Number(minimum) >= 0 && Number(minimum) <= 199 && Number(target) > Number(minimum) && Number(target) <= 200 &&
    Number(batch) >= 1 && Number(batch) <= 200;
  const save = async () => {
    if (!valid || pending || !isSuperAdmin || !isAuthenticated || !pool.configured) return;
    setPending(true); setFeedback(''); setError('');
    try {
      const { data, error: rpcError } = await supabaseClient.rpc('admin_configure_refund_gift_card_supply', {
        p_pool_id: pool.id, p_min_available: Number(minimum), p_target_available: Number(target),
        p_max_batch_size: Number(batch), p_provider_config: null, p_validity_days: null, p_renew_before_days: null,
      });
      if (rpcError) throw new Error(rpcError.message);
      if (data?.configured !== true || data?.payloadRedacted !== true) throw new Error('Unable to confirm the stock settings were saved.');
      setFeedback('Stock settings saved.');
      await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save stock settings.'); }
    finally { setPending(false); }
  };
  if (!isSuperAdmin || !isAuthenticated) return null;
  return <details className="mt-3">
    <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Stock settings</summary>
    <div className="space-y-3 pb-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div><Label htmlFor={`supply-min-${pool.id}`}>Start replenishing below</Label><Input id={`supply-min-${pool.id}`} type="number" min={0} max={199} value={minimum} onChange={(event) => setMinimum(event.target.value)} className="mt-2 min-h-11" /></div>
        <div><Label htmlFor={`supply-target-${pool.id}`}>Target available stock</Label><Input id={`supply-target-${pool.id}`} type="number" min={1} max={200} value={target} onChange={(event) => setTarget(event.target.value)} className="mt-2 min-h-11" /></div>
        <div><Label htmlFor={`supply-batch-${pool.id}`}>Maximum per replenishment</Label><Input id={`supply-batch-${pool.id}`} type="number" min={1} max={200} value={batch} onChange={(event) => setBatch(event.target.value)} className="mt-2 min-h-11" /></div>
      </div>
      {!valid && <p className="text-sm text-destructive">Use whole numbers from 0 to 199 for the minimum, a larger target up to 200, and a replenishment maximum from 1 to 200.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {feedback && <p role="status" className="text-sm text-emerald-800">{feedback}</p>}
      <Button type="button" className="min-h-11" disabled={!valid || pending} onClick={() => void save()}>{pending ? 'Saving…' : 'Save stock settings'}</Button>
    </div>
  </details>;
}

export function RefundGiftCardSupplySection() {
  const { isSuperAdmin, isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const query = useQuery({ queryKey: ['refund-gift-card-supply'], enabled: open && isSuperAdmin && isAuthenticated,
    queryFn: async () => {
      const { data, error } = await supabaseClient.rpc('admin_get_refund_gift_card_supply');
      if (error) throw new Error(error.message);
      return requireRefundGiftCardSupply(data);
    }, retry: false, refetchInterval: open ? 30000 : false });
  if (!isSuperAdmin || !isAuthenticated) return null;
  return <details data-testid="refund-gift-card-supply" className="mt-6 border-t border-border pt-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Gift card supply</summary>
    <div className="space-y-3 pb-4">
      {query.isPending && <p role="status" className="text-sm text-muted-foreground">Loading stock and automatic replenishment…</p>}
      {query.error && <p role="alert" className="text-sm text-destructive">Gift card supply could not be loaded. <Button variant="link" onClick={() => void query.refetch()}>Try again</Button></p>}
      {query.data?.length === 0 && <p className="text-sm text-muted-foreground">Gift-card supply is being set up.</p>}
      {query.data && query.data.length > 0 && <ul className="divide-y divide-border">
        {query.data.map((pool) => <li key={pool.id} className="py-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h3 className="text-sm font-semibold">{giftCardAmount(pool.faceValueCents, pool.currency)} · {pool.provider === 'sunzee' ? 'Sunzee' : pool.provider === 'kemore' ? 'Kemore' : 'Gift card provider'}</h3>
              <p className="mt-1 break-words text-sm text-muted-foreground">{pool.eligibleLocations.join(', ') || 'Location setup pending'}</p></div>
            <p className="text-sm font-medium">{pool.usableCount} ready to use</p>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{refundGiftCardSupplyStatus(pool)}{pool.expiredCount > 0 ? ` · ${pool.expiredCount} expired codes excluded` : ''}</p>
          {pool.configured && <StockSettings key={pool.id} pool={pool} onSaved={() => query.refetch()} />}
        </li>)}
      </ul>}
    </div>
  </details>;
}

import { useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { downloadOperatorPayStatementHtml, fetchPayStatementArtifact } from '@/lib/operatorPayouts';

export function PayStubLoading() {
  const { t } = useLanguage();
  return <div role="status" className="space-y-3 py-4"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-8 w-1/2" /><span className="sr-only">{t('payStub.loading')}</span></div>;
}

export function PayStubError({ onRetry, busy = false }: { onRetry: () => void; busy?: boolean }) {
  const { t } = useLanguage();
  return <div role="alert" className="space-y-3"><p className="text-sm leading-6 text-muted-foreground">{t('payStub.unavailable')}</p><Button variant="outline" className="min-h-11" onClick={onRetry} disabled={busy}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />{t('dashboard.retryStatus')}</Button></div>;
}

export function PayStubDownload({ statementId }: { statementId: string }) {
  const { t } = useLanguage();
  const [pending, setPending] = useState(false);
  const download = async () => {
    setPending(true);
    try {
      // Recheck the current published version at click time, including after a revision.
      await downloadOperatorPayStatementHtml(await fetchPayStatementArtifact(statementId));
      toast.success(t('payStub.downloaded'));
    } catch {
      toast.error(t('payStub.downloadError'));
    } finally { setPending(false); }
  };
  return <Button variant="outline" className="min-h-11" disabled={pending} onClick={() => void download()}>{pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Download className="mr-2 h-4 w-4" aria-hidden="true" />}{t('workday.downloadPay')}</Button>;
}

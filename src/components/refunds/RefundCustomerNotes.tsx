import { useQuery } from '@tanstack/react-query';
import { fetchRefundGmailCaseContext, type RefundCaseRecord } from '@/lib/refundOperations';
import { latestVerifiedCustomerNote } from '@/lib/refundCustomerNotes';

function NoteText({ text }: { text: string }) {
  if (text.length <= 400) return <p className="whitespace-pre-line break-words text-sm leading-6">{text}</p>;
  return <details className="text-sm leading-6"><summary className="min-h-11 cursor-pointer py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    {text.slice(0, 220)}… <span className="font-medium underline">Read full comment</span>
  </summary><p className="whitespace-pre-line break-words">{text}</p></details>;
}

/** Optional context: its reads and empty states never disable case decisions. */
export function RefundCustomerNotes({ refundCase }: { refundCase: RefundCaseRecord }) {
  const original = refundCase.issueSummary?.trim();
  const query = useQuery({ queryKey: ['refund-gmail-case-context', refundCase.id],
    queryFn: ({ signal }) => fetchRefundGmailCaseContext(refundCase.id, signal), enabled: Boolean(refundCase.hasGmailThread),
    staleTime: 30_000, retry: false });
  const reply = latestVerifiedCustomerNote(query.data?.messages);
  const deleted = query.data?.messages.some(message => message.direction === 'inbound'
    && message.participantRole === 'customer' && message.participantTrust === 'verified' && message.contentDeleted);
  return <div data-testid="refund-customer-notes" className="mt-2 space-y-3">
    {original && <div><p className="text-xs font-medium text-muted-foreground">Original customer comment</p><NoteText text={original} /></div>}
    {reply && <div><p className="text-xs font-medium text-muted-foreground">Latest customer reply · {new Date(reply.receivedAt).toLocaleDateString()}</p><NoteText text={reply.body} /></div>}
    {!original && !reply && <p className="text-xs text-muted-foreground">{refundCase.hasGmailThread && query.isPending
      ? 'Customer replies are loading.' : query.isError ? 'Customer replies are temporarily unavailable.'
        : deleted ? 'Earlier customer reply content is no longer retained.' : 'No additional customer comment.'}</p>}
  </div>;
}

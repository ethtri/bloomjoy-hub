import { CheckCircle2, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { checkoutOrderLabel, type CheckoutReturnState } from '@/lib/checkoutReturn';

type Props = {
  state: CheckoutReturnState;
  onRetry: () => void;
  onDismiss: () => void;
  hasCart?: boolean;
  cartRetained?: boolean;
};

export function CheckoutReturnNotice({ state, onRetry, onDismiss, hasCart = false, cartRetained = false }: Props) {
  if (state.status === 'none') return null;
  const paid = state.status === 'paid';
  const checking = state.status === 'checking';
  const canceled = state.status === 'canceled';
  const title = paid ? 'Payment confirmed' : checking ? 'Checking your payment' : canceled ? 'Checkout canceled' : state.status === 'pending' ? 'Payment is not yet confirmed' : 'We couldn’t verify your payment';

  return (
    <section aria-live="polite" aria-atomic="true" className="rounded-xl border border-border bg-card p-5 sm:p-8">
      <div className="flex items-start gap-3">
        {paid && <CheckCircle2 aria-hidden="true" className="mt-1 h-6 w-6 shrink-0 text-sage" />}
        {checking && <Loader2 aria-hidden="true" className="mt-1 h-6 w-6 shrink-0 animate-spin motion-reduce:animate-none" />}
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-bold text-foreground">{title}</h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            {paid
              ? `We’ve confirmed payment for your ${checkoutOrderLabel(state.orderType)}. Check the email you used at checkout for your receipt and order updates.`
              : checking
                ? 'Please wait while we check the checkout result.'
                : canceled
                  ? `You can continue shopping whenever you’re ready.${hasCart ? ' Your cart has been kept.' : ''}`
                  : `Check again before starting another payment.${hasCart ? ' Your cart has been kept.' : ''} If you need help, contact Bloomjoy using the email you entered at checkout.`}
          </p>
          {paid && cartRetained && <p className="mt-3 max-w-2xl text-sm text-muted-foreground">Your current cart has been kept. Review it before placing another order.</p>}
          {!checking && (
            <div className="mt-5 flex flex-wrap gap-3">
              {!paid && !canceled && <Button variant="outline" onClick={onRetry}>Check payment again</Button>}
              <Button variant="outline" onClick={onDismiss}>{paid ? 'Start another order' : canceled ? 'Continue shopping' : hasCart ? 'Review cart' : 'Review order'}</Button>
              {(paid || !canceled) && <Button asChild variant="link"><Link to="/contact">Contact Bloomjoy</Link></Button>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

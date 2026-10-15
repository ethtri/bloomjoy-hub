import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getCheckoutStatus } from '@/lib/stripeCheckout';
import { readCheckoutReturn, type CheckoutReturnScope, type CheckoutReturnState } from '@/lib/checkoutReturn';

export function useCheckoutReturn(scope: CheckoutReturnScope, onPaid?: (sessionId: string) => void) {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryKey = scope === 'cart' ? 'checkout' : 'sticksCheckout';
  const result = searchParams.get(queryKey);
  const sessionId = searchParams.get('session_id');
  // Match the prerendered public page before reading return parameters in the
  // effect. A successful URL alone is never a payment state.
  const [state, setState] = useState<CheckoutReturnState>({ status: 'none' });
  const [attempt, setAttempt] = useState(0);
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;

  useEffect(() => {
    let canceled = false;
    if (result === 'return' && sessionId) setState({ status: 'checking' });
    void readCheckoutReturn(result, sessionId, scope, getCheckoutStatus).then((nextState) => {
      if (canceled) return;
      setState(nextState);
      if (nextState.status === 'paid' && sessionId) {
        onPaidRef.current?.(sessionId);
      }
    });
    return () => { canceled = true; };
  }, [attempt, result, scope, sessionId]);

  const dismiss = () => {
    const params = new URLSearchParams(searchParams);
    params.delete(queryKey);
    params.delete('session_id');
    setSearchParams(params, { replace: true });
  };

  return { state, retry: () => setAttempt((current) => current + 1), dismiss };
}

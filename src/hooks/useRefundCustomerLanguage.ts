import { useEffect, useRef, useState } from 'react';
import { refundCustomerText, type RefundCustomerLocale } from '@/lib/refundCustomerCopy';

export const refundLanguageStorageKey = 'bloomjoy.refund.language.v1';
export function useRefundCustomerLanguage(preferredLocale?: RefundCustomerLocale | null) {
  const explicitChoice = useRef(false);
  const [locale, setLocale] = useState<RefundCustomerLocale>(() => {
    if (typeof window === 'undefined') return 'en';
    const query = new URLSearchParams(window.location.search).get('lang');
    if (query === 'es' || query === 'en') { explicitChoice.current = true; return query; }
    try { const saved = window.localStorage.getItem(refundLanguageStorageKey); explicitChoice.current = saved === 'es' || saved === 'en'; return saved === 'es' ? 'es' : 'en'; }
    catch { return 'en'; }
  });
  useEffect(() => { if (preferredLocale && !explicitChoice.current) setLocale(preferredLocale); }, [preferredLocale]);
  useEffect(() => {
    try { window.localStorage.setItem(refundLanguageStorageKey, locale); } catch { /* Private browsing can disable storage. */ }
  }, [locale]);
  return { locale, setLocale: (next: RefundCustomerLocale) => { explicitChoice.current = true; setLocale(next); }, t: (text: string) => refundCustomerText(text, locale) };
}

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  getBuyerCtaClassification,
  getMachineAnalyticsContext,
  sanitizeAnalyticsPath,
  trackEvent,
  trackPublicPageView,
} from '@/lib/analytics';

const getAnchorFromTarget = (target: EventTarget | null) =>
  target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null;

export const PublicAnalyticsRouteTracker = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    trackPublicPageView(pathname);
  }, [pathname]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const anchor = getAnchorFromTarget(event.target);
      if (!anchor) {
        return;
      }

      let destinationUrl: URL;
      try {
        destinationUrl = new URL(anchor.href, window.location.origin);
      } catch {
        return;
      }

      if (destinationUrl.origin !== window.location.origin) {
        return;
      }

      const destination = sanitizeAnalyticsPath(destinationUrl.pathname);
      const cta = getBuyerCtaClassification(destination);
      if (!destination || !cta) {
        return;
      }

      trackEvent('buyer_cta_click', {
        cta,
        destination,
        machine:
          getMachineAnalyticsContext(window.location.pathname) ??
          getMachineAnalyticsContext(destination),
        route: window.location.pathname,
      });
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  return null;
};

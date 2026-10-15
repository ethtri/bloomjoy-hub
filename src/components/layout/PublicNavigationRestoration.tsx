import { useEffect, useLayoutEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

// Key by history entry so Back returns to the exact place the customer left.
const positions = new Map<string, number>();
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function PublicNavigationRestoration() {
  const location = useLocation();
  const navigationType = useNavigationType();

  useBrowserLayoutEffect(() => {
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    let target: HTMLElement | null = null;
    if (location.hash) {
      try {
        target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      } catch {
        // A malformed incoming fragment still opens the page at its beginning.
      }
    }
    const savedPosition = navigationType === 'POP' ? positions.get(location.key) : undefined;
    let restoring = savedPosition !== undefined;
    let observer: ResizeObserver | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finishRestoring = () => {
      restoring = false;
      observer?.disconnect();
      if (timeout) clearTimeout(timeout);
    };
    if (savedPosition !== undefined) {
      // Accordions and lazy media can grow after mount. Restore against the
      // settled height instead of permanently accepting a clamped position.
      const restorePosition = () => {
        if (!restoring) return;
        window.scrollTo({ top: savedPosition, behavior: 'instant' });
        if (Math.abs(window.scrollY - savedPosition) < 1) finishRestoring();
      };
      observer = new ResizeObserver(restorePosition);
      observer.observe(document.body);
      restorePosition();
      if (restoring) timeout = setTimeout(finishRestoring, 1500);
    } else if (target) {
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    } else {
      window.scrollTo({ top: 0, behavior: 'instant' });
      if (navigationType !== 'POP') {
        document.getElementById('main-content')?.focus({ preventScroll: true });
      }
    }

    const rememberPosition = () => {
      if (!restoring) positions.set(location.key, window.scrollY);
    };
    // A customer's next action always takes priority over automatic recovery.
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
      window.addEventListener(event, finishRestoring, { passive: true });
    }
    window.addEventListener('scroll', rememberPosition, { passive: true });
    window.addEventListener('pagehide', rememberPosition);
    // Bound memory for long browsing sessions without discarding recent entries.
    if (positions.size > 100) positions.delete(positions.keys().next().value!);
    return () => {
      finishRestoring();
      for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
        window.removeEventListener(event, finishRestoring);
      }
      window.removeEventListener('scroll', rememberPosition);
      window.removeEventListener('pagehide', rememberPosition);
      window.history.scrollRestoration = previousRestoration;
    };
  }, [location.key, location.hash, navigationType]);

  return null;
}

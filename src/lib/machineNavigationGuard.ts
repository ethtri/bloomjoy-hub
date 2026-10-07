// Imported by App before BrowserRouter registers its history listener. A declined
// native Back/Forward must retain the current editor instead of unmounting drafts.
let guard: ((event: PopStateEvent) => void) | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', event => guard?.(event), true);
}

export function registerMachineNavigationGuard(confirmLeave: () => boolean) {
  const editorIndex = window.history.state?.idx;
  if (typeof editorIndex !== 'number') return () => {};
  let restoring = false;
  const activeGuard = (event: PopStateEvent) => {
    if (restoring) { restoring = false; return; }
    const nextIndex = event.state?.idx;
    if (typeof nextIndex !== 'number' || nextIndex === editorIndex || confirmLeave()) return;
    event.stopImmediatePropagation();
    restoring = true;
    window.history.go(editorIndex - nextIndex);
  };
  guard = activeGuard;
  return () => { if (guard === activeGuard) guard = null; };
}

export type ReservedSignedExportWindow = Window | null;

export const reserveSignedExportWindow = (): ReservedSignedExportWindow => {
  if (typeof window === 'undefined') return null;

  const target = window.open('about:blank', '_blank');
  if (target) {
    target.opener = null;
  }

  return target;
};

export const closeReservedSignedExportWindow = (
  target: ReservedSignedExportWindow
) => {
  if (!target || target.closed) return;

  try {
    target.close();
  } catch {
    // The browser may deny closing tabs it did not associate with this script.
  }
};

export const openSignedExportUrl = (
  signedUrl: string,
  target: ReservedSignedExportWindow
) => {
  if (target && !target.closed) {
    target.location.href = signedUrl;
    return;
  }

  const fallback = window.open(signedUrl, '_blank', 'noopener,noreferrer');
  if (!fallback) {
    window.location.assign(signedUrl);
  }
};

const formatIssuedDate = (issuedAt: string) =>
  new Date(issuedAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

export const downloadTrainingCertificateSvg = ({
  recipientName,
  trackTitle,
  issuedAt,
}: {
  recipientName: string;
  trackTitle: string;
  issuedAt: string;
}) => {
  const safeRecipient = escapeXml(recipientName.trim() || 'Bloomjoy Member');
  const safeTrackTitle = escapeXml(trackTitle.trim() || 'Bloomjoy Operator Essentials');
  const issuedLabel = escapeXml(formatIssuedDate(issuedAt));

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1400" height="990" viewBox="0 0 1400 990" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="1400" height="990" rx="36" fill="#FFF8EE"/>
  <rect x="30" y="30" width="1340" height="930" rx="28" stroke="#D8863A" stroke-width="4"/>
  <rect x="74" y="74" width="1252" height="842" rx="24" stroke="#1F5D50" stroke-width="2" stroke-dasharray="10 14"/>
  <text x="700" y="182" text-anchor="middle" font-family="Georgia, serif" font-size="28" fill="#1F5D50">Bloomjoy Plus</text>
  <text x="700" y="274" text-anchor="middle" font-family="Georgia, serif" font-size="72" font-weight="700" fill="#2E261F">Certificate of Completion</text>
  <text x="700" y="356" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" fill="#6B5E53">This certifies that</text>
  <text x="700" y="454" text-anchor="middle" font-family="Georgia, serif" font-size="58" font-weight="700" fill="#D8863A">${safeRecipient}</text>
  <text x="700" y="538" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" fill="#6B5E53">completed the Bloomjoy training path</text>
  <text x="700" y="622" text-anchor="middle" font-family="Georgia, serif" font-size="48" font-weight="700" fill="#1F5D50">${safeTrackTitle}</text>
  <text x="700" y="708" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" fill="#6B5E53">Issued on ${issuedLabel}</text>
  <line x1="230" y1="824" x2="560" y2="824" stroke="#2E261F" stroke-width="2"/>
  <line x1="840" y1="824" x2="1170" y2="824" stroke="#2E261F" stroke-width="2"/>
  <text x="395" y="858" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="#6B5E53">Bloomjoy Training Program</text>
  <text x="1005" y="858" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="#6B5E53">Operator Essentials Track</text>
</svg>`;

  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const fileSafeTrack = trackTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  link.href = url;
  link.download = `${fileSafeTrack || 'training-certificate'}.svg`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

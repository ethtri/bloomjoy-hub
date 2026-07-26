import QRCode from 'qrcode';
import { APP_ORIGIN } from '@/lib/seoRoutes';

const publicQrPathPattern = /^\/refunds\/request\?qr=[A-Za-z0-9_-]{32,80}$/;

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const safeFileSegment = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'machine';

export const REFUND_QR_APP_ORIGIN = APP_ORIGIN;

export const buildRefundQrUrl = (publicPath: string) => {
  if (!publicQrPathPattern.test(publicPath)) {
    throw new Error('The refund QR path is invalid. Rotate the code before printing it.');
  }

  return new URL(publicPath, `${REFUND_QR_APP_ORIGIN}/`).toString();
};

export type RefundQrPrintAsset = {
  claimUrl: string;
  qrDataUrl: string;
  svg: string;
  fileName: string;
};

export const buildRefundQrPrintAsset = async ({
  publicPath,
  locationName,
  machineLabel,
  version,
}: {
  publicPath: string;
  locationName: string;
  machineLabel: string;
  version: number;
}): Promise<RefundQrPrintAsset> => {
  const claimUrl = buildRefundQrUrl(publicPath);
  const qrDataUrl = await QRCode.toDataURL(claimUrl, {
    errorCorrectionLevel: 'H',
    margin: 4,
    width: 1024,
    color: {
      dark: '#111827',
      light: '#ffffff',
    },
  });
  const safeLocation = escapeXml(locationName.trim() || 'Bloomjoy location');
  const safeMachine = escapeXml(machineLabel.trim() || 'Bloomjoy machine');
  const safeVersion = Number.isInteger(version) && version > 0 ? version : 1;
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600" role="img" aria-labelledby="title description">',
    '<title id="title">Bloomjoy refund help QR code</title>',
    '<description id="description">Print-ready machine label that opens the Bloomjoy refund request form.</description>',
    '<rect width="1200" height="1600" rx="48" fill="#fffafc"/>',
    '<rect x="28" y="28" width="1144" height="1544" rx="36" fill="none" stroke="#f672a2" stroke-width="16"/>',
    '<text x="600" y="150" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="62" font-weight="700" fill="#a61e4d">Need refund help?</text>',
    '<text x="600" y="225" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="36" fill="#374151">Scan this code to report your purchase.</text>',
    `<image x="170" y="285" width="860" height="860" href="${qrDataUrl}"/>`,
    '<rect x="100" y="1205" width="1000" height="230" rx="28" fill="#ffffff" stroke="#e5e7eb" stroke-width="4"/>',
    `<text x="600" y="1285" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="700" fill="#111827">${safeLocation}</text>`,
    `<text x="600" y="1350" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="34" fill="#374151">${safeMachine}</text>`,
    `<text x="600" y="1500" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="26" fill="#6b7280">Bloomjoy refund QR · Version ${safeVersion}</text>`,
    '</svg>',
  ].join('');

  return {
    claimUrl,
    qrDataUrl,
    svg,
    fileName: `bloomjoy-refund-qr-${safeFileSegment(locationName)}-${safeFileSegment(machineLabel)}-v${safeVersion}.svg`,
  };
};

export const downloadRefundQrPrintAsset = (asset: RefundQrPrintAsset) => {
  const objectUrl = URL.createObjectURL(
    new Blob([asset.svg], { type: 'image/svg+xml;charset=utf-8' })
  );
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = asset.fileName;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
};

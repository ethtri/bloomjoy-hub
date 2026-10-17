export const REFUND_PORTAL_HUMAN_REVIEW_SCREENSHOTS = [
  'refund-portal-uat-desktop.png',
  'refund-portal-uat-mobile.png',
  'refund-portal-uat-cash-success.png',
  'refund-portal-gmail-draft-desktop.png',
  'refund-portal-uat-multiple-candidates.png',
  'refund-email-pilot-duplicate-review-desktop.png',
  'refund-one-manager-decision-desktop.png',
  'refund-payment-result-review-desktop.png',
  'refund-provider-success.png',
  'refund-provider-unknown.png',
  'refund-obsolete-question-desktop.png',
  'refund-obsolete-question-mobile.png',
  'refund-obsolete-question-queue-375.png',
  'partial-legacy-1440.png',
  'partial-legacy-320.png',
  'partial-confirm-320.png',
];

const humanReviewScreenshotSet = new Set(REFUND_PORTAL_HUMAN_REVIEW_SCREENSHOTS);

export const shouldCaptureRefundPortalScreenshot = (filePath) => {
  const filename = String(filePath ?? '').split(/[\\/]/).pop();
  return humanReviewScreenshotSet.has(filename);
};

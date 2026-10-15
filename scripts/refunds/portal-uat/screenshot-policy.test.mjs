import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REFUND_PORTAL_HUMAN_REVIEW_SCREENSHOTS,
  shouldCaptureRefundPortalScreenshot,
} from './screenshot-policy.mjs';

test('portal evidence keeps one concise set of human-review states', () => {
  assert.equal(REFUND_PORTAL_HUMAN_REVIEW_SCREENSHOTS.length, 13);
  assert.equal(new Set(REFUND_PORTAL_HUMAN_REVIEW_SCREENSHOTS).size, 13);
  assert(shouldCaptureRefundPortalScreenshot('output/refund-obsolete-question-desktop.png'));
  assert(shouldCaptureRefundPortalScreenshot('output/refund-obsolete-question-mobile.png'));
  assert(shouldCaptureRefundPortalScreenshot('output/refund-obsolete-question-queue-375.png'));
  assert.equal(shouldCaptureRefundPortalScreenshot('output/refund-obsolete-question-queue-1440.png'), false);
  assert(shouldCaptureRefundPortalScreenshot('output/refund-provider-unknown.png'));
  assert(shouldCaptureRefundPortalScreenshot('output\\refund-portal-uat-mobile.png'));
  assert.equal(shouldCaptureRefundPortalScreenshot('output/refund-manager-clarity-cached-read-delay.png'), false);
});

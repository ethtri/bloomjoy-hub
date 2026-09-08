import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(
  new URL(`../../${path}`, import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');

const orchestration = read(
  'supabase/migrations/202608040004_refund_nayax_provider_orchestration.sql',
);
const handler = read('supabase/functions/nayax-card-refund/index.ts');
const duplicateRecovery = read(
  'supabase/migrations/20260908221526_refund_same_source_duplicate_settlement_recovery.sql',
);

test('normal claimed v2 completion is dispatched with its stored manual kind', () => {
  const claimStart = orchestration.indexOf(
    'create or replace function public.service_claim_nayax_refund_completion',
  );
  const claimEnd = orchestration.indexOf('\n$$;', claimStart);
  assert.ok(claimStart >= 0 && claimEnd > claimStart);
  const claim = orchestration.slice(claimStart, claimEnd);
  assert.match(
    claim,
    /'deterministic_template',\s*'manual',\s*'refund_nayax_completion_v2'/,
  );

  const deliveryStart = handler.indexOf('deliverCustomerCompletion: async');
  const deliveryEnd = handler.indexOf('\n        },\n      },', deliveryStart);
  assert.ok(deliveryStart >= 0 && deliveryEnd > deliveryStart);
  const delivery = handler.slice(deliveryStart, deliveryEnd);
  assert.match(delivery, /deliveryKind: "manual"/);
  assert.doesNotMatch(delivery, /deliveryKind: "automatic"/);
  assert.match(delivery, /service_prepare_nayax_completion_retry/);
});

test('form completion uses the receipt-bound outbox claim instead of a Gmail thread', () => {
  const formClaimStart = duplicateRecovery.indexOf(
    'create function public.refund_claim_nayax_form_receipt_completion_internal',
  );
  const formClaimEnd = duplicateRecovery.indexOf('\n$$;', formClaimStart);
  assert.ok(formClaimStart >= 0 && formClaimEnd > formClaimStart);
  const formClaim = duplicateRecovery.slice(formClaimStart, formClaimEnd);
  assert.match(formClaim, /refund_receipt_completion_automation_authorities/);
  assert.match(formClaim, /refund_receipt_completion_intents/);
  assert.match(formClaim, /'refund_receipt_completion_v1'/);
  assert.match(formClaim, /message_row\.delivery_kind := 'automatic'/);
  assert.match(formClaim, /message_row\.manual_delivery_state := 'queued'/);
  assert.match(formClaim, /message_row\.manual_delivery_expected_case_version := case_row\.official_action_version/);

  const deliveryStart = handler.indexOf('deliverCustomerCompletion: async');
  const deliveryEnd = handler.indexOf('\n        },\n      },', deliveryStart);
  const delivery = handler.slice(deliveryStart, deliveryEnd);
  assert.match(delivery, /parseNayaxFormReceiptClaim\(claim, caseId\)/);
  assert.match(delivery, /deliverNayaxFormReceiptCompletion/);
  assert.match(delivery, /drainRefundManualMessageOutbox\(\{/);
  assert.match(delivery, /messageId,/);
  assert.match(delivery, /limit: 1/);
});

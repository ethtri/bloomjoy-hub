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

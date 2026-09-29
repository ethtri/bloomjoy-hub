/// <reference lib="deno.ns" />

import { assertEquals } from 'jsr:@std/assert';
import {
  getOptionalSnapCasePartnershipId,
  getSnapCaseMappingEffectiveWindow,
} from './snapcaseMappingWindow.ts';

Deno.test('existing SnapCase mappings retain their exact effective window', () => {
  assertEquals(
    getSnapCaseMappingEffectiveWindow(
      {
        effectiveStartDate: '2025-01-01',
        effectiveEndDate: null,
        firstSeenAt: '2026-09-27T02:28:00.603941Z',
      },
      {
        effective_start_date: '2026-01-01',
        effective_end_date: '2026-12-31',
      },
      '2026-09-28'
    ),
    {
      effectiveStartDate: '2025-01-01',
      effectiveEndDate: null,
    }
  );

  assertEquals(
    getSnapCaseMappingEffectiveWindow(
      {
        effectiveStartDate: '2025-03-01',
        effectiveEndDate: '2025-08-31',
        firstSeenAt: '2026-09-27T02:28:00.603941Z',
      },
      {
        effective_start_date: '2026-01-01',
        effective_end_date: null,
      },
      '2026-09-28'
    ),
    {
      effectiveStartDate: '2025-03-01',
      effectiveEndDate: '2025-08-31',
    }
  );
});

Deno.test('new SnapCase mappings retain the existing partnership and discovery defaults', () => {
  assertEquals(
    getSnapCaseMappingEffectiveWindow(
      {
        effectiveStartDate: null,
        effectiveEndDate: null,
        firstSeenAt: '2026-09-27T02:28:00.603941Z',
      },
      {
        effective_start_date: '2026-01-01',
        effective_end_date: '2026-12-31',
      },
      '2026-09-28'
    ),
    {
      effectiveStartDate: '2026-01-01',
      effectiveEndDate: '2026-12-31',
    }
  );

  assertEquals(
    getSnapCaseMappingEffectiveWindow(
      {
        effectiveStartDate: null,
        effectiveEndDate: null,
        firstSeenAt: '2026-09-27T02:28:00.603941Z',
      },
      undefined,
      '2026-09-28'
    ),
    {
      effectiveStartDate: '2026-09-27',
      effectiveEndDate: null,
    }
  );
});

Deno.test('SnapCase mapping sends no UUID when the optional partnership is blank', () => {
  assertEquals(getOptionalSnapCasePartnershipId(''), null);
  assertEquals(getOptionalSnapCasePartnershipId('   '), null);
  assertEquals(
    getOptionalSnapCasePartnershipId('096ca52a-444a-4d4f-9a2b-8844ddd16a95'),
    '096ca52a-444a-4d4f-9a2b-8844ddd16a95'
  );
});

/// <reference lib="deno.ns" />

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { getHostRedirectTarget } from './appSurface.ts';

Deno.test('public correction route moves from app to www without losing its fragment capability', () => {
  const fragment = `#token=${'s'.repeat(43)}`;

  assertEquals(
    getHostRedirectTarget(
      { hostname: 'app.bloomjoyusa.com', origin: 'https://app.bloomjoyusa.com' },
      '/refunds/correct',
      '',
      fragment,
    ),
    `https://www.bloomjoyusa.com/refunds/correct${fragment}`,
  );
});

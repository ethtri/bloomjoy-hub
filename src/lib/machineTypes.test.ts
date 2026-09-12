/// <reference lib="deno.ns" />

import {
  formatMachineType,
  machineTypeOptions,
  normalizeMachineType,
} from './machineTypes.ts';

Deno.test('machine type options expose exactly the four approved display values', () => {
  const actual = machineTypeOptions.map(({ label }) => label);
  const expected = [
    'Cotton Candy - Commercial',
    'Cotton Candy - Mini',
    'Cotton Candy Micro',
    'Snapcase',
  ];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected machine type labels: ${JSON.stringify(actual)}`);
  }
});

Deno.test('legacy keys and customer-facing labels normalize to canonical storage values', () => {
  const cases = [
    ['commercial', 'commercial'],
    ['Cotton Candy - Commercial', 'commercial'],
    ['mini', 'mini'],
    ['Cotton Candy - Mini', 'mini'],
    ['micro', 'micro'],
    ['Cotton Candy Micro', 'micro'],
    ['SnapCase', 'snapcase'],
    ['snap_case', 'snapcase'],
  ] as const;

  for (const [input, expected] of cases) {
    if (normalizeMachineType(input) !== expected) {
      throw new Error(`${input} did not normalize to ${expected}`);
    }
  }
});

Deno.test('ambiguous legacy values stay unverified instead of being silently reclassified', () => {
  if (normalizeMachineType('unknown') !== null) {
    throw new Error('Unknown machine type must remain unclassified.');
  }
  if (formatMachineType('unknown') !== 'Product unverified') {
    throw new Error('Unknown machine type should have a truthful fallback label.');
  }
});

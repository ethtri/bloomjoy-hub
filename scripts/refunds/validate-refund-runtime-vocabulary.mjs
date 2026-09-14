import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const runtimeRoot = resolve(root, 'supabase', 'functions');
const retiredPhrases = [
  ['refund', 'operations'].join(' '),
  ['payment', 'support'].join(' '),
  ['safe', 'stopping', 'point'].join(' '),
];

const walk = (directory) => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return statSync(path).isFile() ? [path] : [];
  });

const productionSources = walk(runtimeRoot).filter((path) =>
  ['.ts', '.mjs'].includes(extname(path)) &&
  !path.endsWith('.test.ts') &&
  !path.endsWith('.test.mjs')
);

const failures = productionSources.flatMap((path) => {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/u);
  return lines.flatMap((line, index) => retiredPhrases
    .filter((phrase) => line.toLowerCase().includes(phrase))
    .map((phrase) => `${relative(root, path)}:${index + 1}: retired phrase "${phrase}"`));
});

assert.deepEqual(
  failures,
  [],
  `Current refund Edge Function source contains retired operating roles:\n${failures.join('\n')}`,
);

console.log(`Refund runtime vocabulary check passed (${productionSources.length} production files).`);

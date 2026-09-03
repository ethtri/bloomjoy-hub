import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { classifyRefundChanges, readRefundChangedPaths } from './refund-change-scope.mjs';

test('only established prose locations can skip refund UAT; mixed and unrecognized inputs cannot', () => {
  assert.equal(classifyRefundChanges(['README.md', 'AGENTS.md', 'Docs/REFUND_AGENT_OPERATIONS.md', '.agents/skills/example/SKILL.md']).protected, false);
  for (const file of [
    'supabase/functions/_shared/renamed.ts', 'lib/shared-helper.ts',
    'src/pages/RefundCorrection.tsx', 'supabase/migrations/20260903000000_example.sql',
    'supabase/tests/new-test.sql', 'supabase/config.toml', 'scripts/new-helper.mjs',
    '.github/workflows/new-workflow.yml', 'package-lock.json', 'vite.config.ts',
    'public/assets/refund.css', 'src/content/example.md', 'unknown/location.md',
    'Docs/../src/runtime.md', '/Docs/example.md', 'Docs\\example.md', '', null,
  ]) assert.equal(classifyRefundChanges(['README.md', file]).protected, true, String(file));
  assert.throws(() => classifyRefundChanges(null), /array/);
});

test('real Git comparison protects deletions and code renamed into a prose location', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refund-scope-'));
  const git = (...args) => {
    const result = spawnSync('git', ['-c', 'user.name=Scope Test', '-c', 'user.email=scope@example.invalid', ...args],
      { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    git('init', '-b', 'main');
    fs.mkdirSync(path.join(root, 'lib'));
    fs.mkdirSync(path.join(root, 'Docs'));
    fs.writeFileSync(path.join(root, 'lib', 'new-shared.ts'), 'export const value = 1;\n');
    fs.writeFileSync(path.join(root, 'README.md'), 'Documentation\n');
    git('add', '.'); git('commit', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(root, 'Docs', 'notes.md'), 'Prose only\n');
    git('add', '.'); git('commit', '-m', 'docs');
    const docsHead = git('rev-parse', 'HEAD');
    assert.equal(classifyRefundChanges(readRefundChangedPaths(base, docsHead, root)).protected, false);
    git('mv', 'lib/new-shared.ts', 'Docs/renamed.md');
    git('commit', '-m', 'rename');
    const renameHead = git('rev-parse', 'HEAD');
    const renamed = readRefundChangedPaths(docsHead, renameHead, root);
    assert(renamed.includes('lib/new-shared.ts'));
    assert(renamed.includes('Docs/renamed.md'));
    assert.equal(classifyRefundChanges(renamed).protected, true);
    assert.throws(() => readRefundChangedPaths('--help', renameHead, root), /exact base/);
    assert.throws(() => readRefundChangedPaths('0'.repeat(40), renameHead, root), /Cannot establish/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('actual workflow condition skips only successful explicit neutral scope', () => {
  const workflow = fs.readFileSync(new URL('../../.github/workflows/refund-uat-evidence.yml', import.meta.url), 'utf8');
  const expression = workflow.split('  screenshots:')[1].match(/^    if: (.+)$/m)?.[1];
  assert(expression, 'Screenshots must have an explicit scope condition');
  const evaluate = new Function('always', 'github', 'needs', `return ${expression};`);
  for (const [event, result, output, expected] of [
    ['pull_request', 'success', 'false', false],
    ['pull_request', 'success', 'true', true],
    ['pull_request', 'success', '', true],
    ['pull_request', 'failure', 'false', true],
    ['pull_request', 'cancelled', undefined, true],
    ['workflow_dispatch', 'success', 'false', true],
  ]) assert.equal(evaluate(() => true, { event_name: event }, { scope: { result, outputs: { required: output } } }), expected);
  const ci = fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert(ci.includes('run: node scripts/refunds/refund-change-scope.mjs "$REFUND_SCOPE_BASE" "$REFUND_SCOPE_HEAD"'),
    'Required verify check must reject failed or missing scope evidence');
});

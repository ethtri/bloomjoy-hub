import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  buildCanonicalDeployArgs,
  parseCanonicalDeployArgs,
  productionAuthorizationPhrase,
  refundProductionProjectRef,
  runCanonicalRefundDeployment,
} from './refund-function-deploy.mjs';

const baseArgs = [
  '--project-ref',
  refundProductionProjectRef,
  '--confirm-project-ref',
  refundProductionProjectRef,
];

test('plan mode selects approved functions in release order without executing commands', () => {
  const options = parseCanonicalDeployArgs([
    ...baseArgs,
    '--function',
    'refund-case-automation-sweep',
    '--function',
    'refund-case-intake',
  ]);
  assert.deepEqual(options.functions, ['refund-case-intake', 'refund-case-automation-sweep']);

  const calls = [];
  const result = runCanonicalRefundDeployment(options, {
    root: 'C:\\safe-repo',
    runner: (...args) => {
      calls.push(args);
      return { status: 0, stdout: '' };
    },
  });
  assert.equal(result.executed, false);
  assert.equal(calls.length, 0);
});

test('canonical deploy arguments pin the repository workdir and exact project', () => {
  const root = path.resolve('C:\\safe-repo');
  assert.deepEqual(buildCanonicalDeployArgs({ slug: 'refund-case-intake', root }), [
    'functions',
    'deploy',
    'refund-case-intake',
    '--no-verify-jwt',
    '--project-ref',
    refundProductionProjectRef,
    '--use-api',
    '--workdir',
    root,
  ]);
});

test('unsafe project, function, selection, and authorization inputs fail closed', () => {
  assert.throws(
    () => parseCanonicalDeployArgs(['--project-ref', 'wrong', '--confirm-project-ref', 'wrong', '--all']),
    /exactly match/
  );
  assert.throws(() => parseCanonicalDeployArgs([...baseArgs, '--all', '--function', 'refund-case-intake']), /exactly one/);
  assert.throws(() => parseCanonicalDeployArgs([...baseArgs, '--function', 'not-a-refund-function']), /Unsupported/);
  assert.throws(() => parseCanonicalDeployArgs([...baseArgs, '--all', '--execute']), /requires --authorize/);
  assert.throws(() => parseCanonicalDeployArgs([...baseArgs, '--all', '--authorize', productionAuthorizationPhrase]), /only together/);
});

test('execution requires exact clean origin main and wraps deployment in both Auth gates', () => {
  const options = parseCanonicalDeployArgs([
    ...baseArgs,
    '--function',
    'refund-case-automation-sweep',
    '--execute',
    '--authorize',
    productionAuthorizationPhrase,
  ]);
  const calls = [];
  const runner = (command, args, runOptions) => {
    calls.push({ command, args, runOptions });
    if (command === 'git' && args.join(' ') === 'rev-parse HEAD') return { status: 0, stdout: 'abc123\n' };
    if (command === 'git' && args.join(' ') === 'rev-parse refs/remotes/origin/main') return { status: 0, stdout: 'abc123\n' };
    if (command === 'git' && args.join(' ') === 'status --porcelain') return { status: 0, stdout: '' };
    return { status: 0, stdout: '' };
  };

  const result = runCanonicalRefundDeployment(options, { runner, root: 'C:\\safe-repo' });
  assert.equal(result.executed, true);
  const phases = calls
    .filter((call) => call.args.includes('--phase'))
    .map((call) => call.args[call.args.indexOf('--phase') + 1]);
  assert.deepEqual(phases, ['predeploy', 'postdeploy']);
  const deploy = calls.find((call) => call.args[0] === 'functions' && call.args[1] === 'deploy');
  assert.equal(deploy.args.at(-2), '--workdir');
  assert.equal(deploy.args.at(-1), 'C:\\safe-repo');
});

test('execution rejects a stale commit or dirty worktree before Auth or Supabase', () => {
  const options = parseCanonicalDeployArgs([
    ...baseArgs,
    '--function',
    'refund-case-automation-sweep',
    '--execute',
    '--authorize',
    productionAuthorizationPhrase,
  ]);

  const staleCalls = [];
  assert.throws(
    () => runCanonicalRefundDeployment(options, {
      root: 'C:\\safe-repo',
      runner: (command, args) => {
        staleCalls.push({ command, args });
        if (args.join(' ') === 'rev-parse HEAD') return { status: 0, stdout: 'old\n' };
        if (args.join(' ') === 'rev-parse refs/remotes/origin/main') return { status: 0, stdout: 'new\n' };
        return { status: 0, stdout: '' };
      },
    }),
    /exact fetched origin\/main/
  );
  assert.equal(staleCalls.some((call) => call.args.includes('--phase')), false);
  assert.equal(staleCalls.some((call) => call.args[0] === 'functions'), false);

  const dirtyCalls = [];
  assert.throws(
    () => runCanonicalRefundDeployment(options, {
      root: 'C:\\safe-repo',
      runner: (command, args) => {
        dirtyCalls.push({ command, args });
        if (args.join(' ') === 'rev-parse HEAD') return { status: 0, stdout: 'same\n' };
        if (args.join(' ') === 'rev-parse refs/remotes/origin/main') return { status: 0, stdout: 'same\n' };
        if (args.join(' ') === 'status --porcelain') return { status: 0, stdout: ' M changed\n' };
        return { status: 0, stdout: '' };
      },
    }),
    /clean worktree/
  );
  assert.equal(dirtyCalls.some((call) => call.args.includes('--phase')), false);
  assert.equal(dirtyCalls.some((call) => call.args[0] === 'functions'), false);
});

test('postdeploy Auth gate still runs after a deployment failure', () => {
  const options = parseCanonicalDeployArgs([
    ...baseArgs,
    '--function',
    'refund-case-automation-sweep',
    '--execute',
    '--authorize',
    productionAuthorizationPhrase,
  ]);
  const phases = [];
  const runner = (command, args) => {
    if (command === 'git' && args.join(' ') === 'rev-parse HEAD') return { status: 0, stdout: 'abc123\n' };
    if (command === 'git' && args.join(' ') === 'rev-parse refs/remotes/origin/main') return { status: 0, stdout: 'abc123\n' };
    if (command === 'git' && args.join(' ') === 'status --porcelain') return { status: 0, stdout: '' };
    if (args.includes('--phase')) phases.push(args[args.indexOf('--phase') + 1]);
    if (args[0] === 'functions' && args[1] === 'deploy') return { status: 1, stdout: '' };
    return { status: 0, stdout: '' };
  };

  assert.throws(
    () => runCanonicalRefundDeployment(options, { runner, root: 'C:\\safe-repo' }),
    /deployment failed/
  );
  assert.deepEqual(phases, ['predeploy', 'postdeploy']);
});

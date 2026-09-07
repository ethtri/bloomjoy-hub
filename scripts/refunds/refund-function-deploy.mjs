#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requiredFunctionSlugs } from './refund-release.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(scriptPath);
export const repoRoot = path.resolve(scriptDirectory, '..', '..');
export const refundProductionProjectRef = 'ygbzkgxktzqsiygjlqyg';
export const productionAuthorizationPhrase = 'DEPLOY CANONICAL REFUND FUNCTIONS';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

export const parseCanonicalDeployArgs = (argv) => {
  const options = {
    projectRef: '',
    confirmProjectRef: '',
    functions: [],
    all: false,
    execute: false,
    authorization: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--project-ref' && value) {
      options.projectRef = value;
      index += 1;
    } else if (argument === '--confirm-project-ref' && value) {
      options.confirmProjectRef = value;
      index += 1;
    } else if (argument === '--function' && value) {
      options.functions.push(value);
      index += 1;
    } else if (argument === '--all') {
      options.all = true;
    } else if (argument === '--execute') {
      options.execute = true;
    } else if (argument === '--authorize' && value) {
      options.authorization = value;
      index += 1;
    } else {
      throw new Error(
        'Unsupported argument. Use --project-ref, --confirm-project-ref, --function, --all, --execute, and --authorize.'
      );
    }
  }

  assert(
    options.projectRef === refundProductionProjectRef &&
      options.confirmProjectRef === refundProductionProjectRef,
    'Both project references must exactly match the Bloomjoy production project.'
  );
  assert(options.all !== (options.functions.length > 0), 'Choose exactly one of --all or one or more --function values.');

  const requested = options.all ? requiredFunctionSlugs : options.functions;
  assert(new Set(requested).size === requested.length, 'Duplicate refund function names are not allowed.');
  for (const slug of requested) {
    assert(requiredFunctionSlugs.includes(slug), `Unsupported refund function: ${slug}`);
  }

  if (options.execute) {
    assert(
      options.authorization === productionAuthorizationPhrase,
      `Production execution requires --authorize "${productionAuthorizationPhrase}".`
    );
  } else {
    assert(options.authorization === '', '--authorize is valid only together with --execute.');
  }

  return {
    ...options,
    functions: requiredFunctionSlugs.filter((slug) => requested.includes(slug)),
  };
};

const commandName = (base) => process.platform === 'win32' && base === 'supabase' ? 'supabase.exe' : base;

const defaultRunner = (command, args, options = {}) => spawnSync(commandName(command), args, {
  cwd: options.cwd ?? repoRoot,
  env: process.env,
  encoding: 'utf8',
  windowsHide: true,
  stdio: options.capture ? 'pipe' : 'inherit',
});

const requireSuccess = (result, message) => {
  if (result.status !== 0) throw new Error(message);
  return result;
};

const readCommand = (runner, command, args, cwd, message) => {
  const result = requireSuccess(runner(command, args, { cwd, capture: true }), message);
  return String(result.stdout ?? '').trim();
};

export const buildCanonicalDeployArgs = ({ slug, root = repoRoot, projectRef = refundProductionProjectRef }) => [
  'functions',
  'deploy',
  slug,
  '--no-verify-jwt',
  '--project-ref',
  projectRef,
  '--use-api',
  '--workdir',
  root,
];

const runAuthGate = (runner, root, projectRef, phase) => requireSuccess(
  runner(process.execPath, [
    path.join(root, 'scripts', 'refunds', 'refund-production-auth-closed.mjs'),
    '--project-ref',
    projectRef,
    '--confirm-project-ref',
    projectRef,
    '--phase',
    phase,
  ], { cwd: root }),
  `${phase} production Auth gate failed.`
);

export const runCanonicalRefundDeployment = (options, { runner = defaultRunner, root = repoRoot } = {}) => {
  const plan = options.functions.map((slug) => ({
    slug,
    args: buildCanonicalDeployArgs({ slug, root, projectRef: options.projectRef }),
  }));

  if (!options.execute) return { executed: false, plan };

  const head = readCommand(runner, 'git', ['rev-parse', 'HEAD'], root, 'Unable to read the deployment commit.');
  const originMain = readCommand(
    runner,
    'git',
    ['rev-parse', 'refs/remotes/origin/main'],
    root,
    'Unable to read origin/main. Fetch before deploying.'
  );
  assert(head === originMain, 'Production refund functions may be deployed only from the exact fetched origin/main commit.');
  assert(
    readCommand(runner, 'git', ['status', '--porcelain'], root, 'Unable to verify the deployment worktree.').length === 0,
    'Production refund functions require a clean worktree.'
  );

  requireSuccess(
    runner(process.execPath, [path.join(root, 'scripts', 'refunds', 'refund-release.mjs'), '--local', '--fetch-reviewed-source'], { cwd: root }),
    'Refund release source alignment failed.'
  );
  runAuthGate(runner, root, options.projectRef, 'predeploy');

  let deploymentError = null;
  try {
    for (const entry of plan) {
      requireSuccess(
        runner('supabase', entry.args, { cwd: root }),
        `Canonical deployment failed for ${entry.slug}.`
      );
    }
  } catch (error) {
    deploymentError = error;
  }

  let postdeployError = null;
  try {
    runAuthGate(runner, root, options.projectRef, 'postdeploy');
  } catch (error) {
    postdeployError = error;
  }

  if (deploymentError && postdeployError) {
    throw new Error(`${deploymentError.message} ${postdeployError.message}`);
  }
  if (deploymentError) throw deploymentError;
  if (postdeployError) throw postdeployError;

  // A complete release is not successful until every deployed transitive source matches.
  // The capture is read-only in production and writes only a local ignored receipt.
  if (options.all) {
    requireSuccess(
      runner(process.execPath, [
        path.join(root, 'scripts', 'refunds', 'refund-release.mjs'),
        '--capture-production',
        '--project-ref', options.projectRef,
        '--confirm-project-ref', options.projectRef,
        '--output', `output/refund-production-postdeploy-${head}.json`,
      ], { cwd: root }),
      'Postdeploy refund source verification failed; release is not accepted.'
    );
  }

  return { executed: true, plan };
};

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === scriptPath;
if (isDirectRun) {
  try {
    const options = parseCanonicalDeployArgs(process.argv.slice(2));
    const result = runCanonicalRefundDeployment(options);
    if (!result.executed) {
      console.log(`Canonical refund deployment plan: ${result.plan.map((entry) => entry.slug).join(', ')}`);
      console.log(`No production write performed. Add --execute --authorize "${productionAuthorizationPhrase}" only in the governed release window.`);
    } else {
      console.log(`Canonical refund deployment completed for ${result.plan.length} function(s).`);
    }
  } catch (error) {
    console.error(`Canonical refund deployment failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exit(1);
  }
}

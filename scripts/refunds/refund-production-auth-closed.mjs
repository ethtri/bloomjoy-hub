#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatHostedRefundTotpPass,
  readHostedRefundTotpState,
  requireCanonicalRefundTotpSourceClosed,
  requireExactRefundProductionProject,
  requireHostedRefundTotpState,
  requireOwnerHeldAuthConfigReadToken,
} from './refund-auth-control-plane.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const parseArgs = (argv) => {
  const result = { projectRef: '', confirmedProjectRef: '', phase: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];
    if (argument === '--project-ref' && next) {
      result.projectRef = next;
      index += 1;
    } else if (argument === '--confirm-project-ref' && next) {
      result.confirmedProjectRef = next;
      index += 1;
    } else if (argument === '--phase' && next) {
      result.phase = next.trim().toLowerCase();
      index += 1;
    } else {
      throw new Error(
        'Unsupported argument. Use only --project-ref, --confirm-project-ref, and --phase.'
      );
    }
  }
  if (!['predeploy', 'postdeploy'].includes(result.phase)) {
    throw new Error('--phase must be predeploy or postdeploy.');
  }
  return result;
};

const main = async () => {
  const { projectRef, confirmedProjectRef, phase } = parseArgs(process.argv.slice(2));
  requireCanonicalRefundTotpSourceClosed({ repoRoot });
  requireExactRefundProductionProject({ projectRef, confirmedProjectRef });
  const accessToken = requireOwnerHeldAuthConfigReadToken();
  const state = await readHostedRefundTotpState({
    projectRef,
    confirmedProjectRef,
    accessToken,
  });
  requireHostedRefundTotpState(state, false);
  console.log(formatHostedRefundTotpPass({
    state,
    label: `${phase} production Auth gate passed`,
  }));
};

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : 'Auth gate failed.'}`);
  process.exit(1);
});

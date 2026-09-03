#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isRefundReleaseProtectedPath } from './refund-release.mjs';

export function classifyRefundChanges(paths) {
  if (!Array.isArray(paths)) throw new Error('Changed-path evidence must be an array');
  const protectedPaths = paths.filter(isRefundReleaseProtectedPath);
  return { protected: protectedPaths.length > 0, changedCount: paths.length, protectedPaths };
}

export function readRefundChangedPaths(base, head, cwd = process.cwd()) {
  if (![base, head].every((ref) => /^[a-f0-9]{40}$/.test(ref ?? ''))) {
    throw new Error('Scope comparison requires exact base and head commits');
  }
  const result = spawnSync('git', ['diff', '--name-only', '-z', '--no-renames', `${base}...${head}`],
    { cwd, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('Cannot establish refund change scope');
  return result.stdout.split('\0').filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = classifyRefundChanges(readRefundChangedPaths(process.argv[2], process.argv[3]));
    const summary = `Refund UAT: ${result.protected ? 'required (protected or unrecognized inputs)' : 'skipped (documentation-only diff)'}; ${result.changedCount} changed paths.`;
    console.log(summary);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `required=${result.protected}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAX_ENTRIES = 20;

export function summarizeTrackedStatus(porcelain) {
  const lines = porcelain.split(/\r?\n/).filter(Boolean);
  const entries = lines.slice(0, MAX_ENTRIES).map((line) => {
    const status = line.slice(0, 2);
    const relativePath = line.slice(3);
    if (!/^[ MADRCU?!]{2}$/.test(status) || !relativePath ||
      /(?:^|[\\/])\.env(?:[.\\/]|$)|\.(?:pem|key)(?:"|$)/i.test(relativePath) ||
      /(?:^|\s)(?:[A-Za-z]:[\\/]|[\\/]{2}|\/home\/|\/Users\/)/.test(relativePath)) {
      return { status, path: '[redacted]' };
    }
    return { status, path: relativePath.slice(0, 180) };
  });
  return { changedTrackedCount: lines.length, entries,
    omittedCount: Math.max(0, lines.length - MAX_ENTRIES) };
}

export function logTrackedStatus(stage, root = process.cwd()) {
  if (!['checkout', 'postinstall', 'prebuild', 'postbuild'].includes(stage)) {
    throw new Error('Invalid source diagnostic stage');
  }
  try {
    const porcelain = execFileSync('git',
      ['status', '--porcelain=v1', '--untracked-files=no'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    console.log(`[portal-source:${stage}] ${JSON.stringify(summarizeTrackedStatus(porcelain))}`);
  } catch {
    console.log(`[portal-source:${stage}] tracked status unavailable`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  logTrackedStatus(process.argv[2]);
}

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

const normalizedJson = (value) => value && typeof value === 'object'
  ? Array.isArray(value)
    ? value.map(normalizedJson)
    : Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizedJson(value[key])]))
  : value;

export function summarizeVercelConfigDelta(committed, checkout) {
  const counts = (bytes) => ({ bytes: bytes.length,
    crlf: (bytes.toString('utf8').match(/\r\n/g) ?? []).length,
    lf: (bytes.toString('utf8').match(/(?<!\r)\n/g) ?? []).length });
  try {
    const before = JSON.parse(committed.toString('utf8'));
    const after = JSON.parse(checkout.toString('utf8'));
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return { committed: counts(committed), checkout: counts(checkout),
      semanticEqual: JSON.stringify(normalizedJson(before)) ===
        JSON.stringify(normalizedJson(after)),
      changedTopLevelKeys: keys.filter((key) =>
        JSON.stringify(normalizedJson(before[key])) !== JSON.stringify(normalizedJson(after[key]))),
    };
  } catch {
    return { committed: counts(committed), checkout: counts(checkout),
      semanticEqual: null, changedTopLevelKeys: ['[invalid-json]'] };
  }
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
    if (porcelain.split(/\r?\n/).some((line) => line.slice(3) === 'vercel.json')) {
      const committed = execFileSync('git', ['show', 'HEAD:vercel.json'],
        { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
      const checkout = readFileSync(`${root}/vercel.json`);
      console.log(`[portal-source:${stage}:config-delta] ${JSON.stringify(
        summarizeVercelConfigDelta(committed, checkout))}`);
    }
  } catch {
    console.log(`[portal-source:${stage}] tracked status unavailable`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  logTrackedStatus(process.argv[2]);
}

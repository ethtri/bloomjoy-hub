import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_FILES = [
  'validate-refund-portal-uat.mjs',
  'validate-refund-qr-intake-uat.mjs',
  'validate-machine-manager-uat.mjs',
];

const countMatches = (source, pattern) => [...source.matchAll(pattern)].length;

export const validateRefundBrowserUatNetworkCoverage = (sources) => {
  const failures = [];

  for (const filename of HARNESS_FILES) {
    const source = sources[filename];
    if (typeof source !== 'string') {
      failures.push(`${filename}: source missing`);
      continue;
    }

    if (!source.includes("from './refund-browser-uat-network.mjs'")) {
      failures.push(`${filename}: shared network helper import missing`);
    }
    if (!/const browser = createTrackedUatBrowser\(\s*await chromium\.launch\(/s.test(source)) {
      failures.push(`${filename}: browser launch is not wrapped at the suite boundary`);
    }
    if (countMatches(source, /chromium\.launch\(/g) !== 1) {
      failures.push(`${filename}: expected exactly one Chromium launch`);
    }
    if (!source.includes('const networkFailures = [];')) {
      failures.push(`${filename}: suite aggregate is missing`);
    }
    if (!/networkFailures\.length\s*(?:===\s*0|,\s*0)/s.test(source)) {
      failures.push(`${filename}: suite aggregate is not asserted fail-closed`);
    }
    if (/\.on\(['"](?:response|requestfailed)['"]/.test(source)) {
      failures.push(`${filename}: ad hoc network listener bypasses shared provenance`);
    }
    if (/errors\.push\([^\n]*response\.url\(\)/.test(source)) {
      failures.push(`${filename}: raw response URL can enter failure output`);
    }
    if (source.includes('machine-manager-uat-network.mjs')) {
      failures.push(`${filename}: obsolete Machine Manager-only helper remains`);
    }
  }

  return failures;
};

const run = async () => {
  const entries = await Promise.all(
    HARNESS_FILES.map(async (filename) => [
      filename,
      await readFile(path.join(SCRIPT_DIR, filename), 'utf8'),
    ])
  );
  const failures = validateRefundBrowserUatNetworkCoverage(Object.fromEntries(entries));
  if (failures.length > 0) {
    throw new Error(`Refund browser UAT network coverage failed:\n- ${failures.join('\n- ')}`);
  }
  console.log('Refund browser UAT network coverage passed for portal, QR, and Machine Manager.');
};

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

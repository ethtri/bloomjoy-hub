import { readFile } from 'node:fs/promises';
import { inspectDtmTaxEvidence } from './dtm-history.mjs';

const files = process.argv.slice(2);
if (!files.length || files.some(file => file.startsWith('--'))) {
  console.error('Usage: node scripts/nayax/audit-dtm-tax-evidence.mjs <private.xlsx> [<private.xlsx> ...]');
  process.exitCode = 1;
} else {
  for (const file of files) {
    try {
      console.log(JSON.stringify(inspectDtmTaxEvidence(await readFile(file))));
    } catch {
      // Provider files, paths and row contents never become public diagnostics.
      console.error('DTM tax evidence audit failed; verify the private workbook format.');
      process.exitCode = 1;
    }
  }
}

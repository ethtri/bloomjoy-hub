import { sourceBuildDiagnostics } from './refund-portal-provenance.mjs';

const phase = process.argv[2];
if (!['before', 'after'].includes(phase) || process.argv.length !== 3)
  throw new Error('Expected before or after build phase');

if (['preview', 'production'].includes(process.env.VERCEL_ENV)) {
  console.log(`Portal source input diagnostic: ${JSON.stringify({
    phase, ...sourceBuildDiagnostics(process.cwd()),
  })}`);
}

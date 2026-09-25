import path from 'node:path';
import { emitMetadata } from './refund-portal-provenance.mjs';

const root = process.cwd();
const metadata = await emitMetadata({ root, dist: path.join(root, 'dist') });
console.log(`Portal build metadata: ${metadata.provenance}, ${metadata.sourceSha ?? 'no source SHA'}, ${metadata.assets.length} public assets.`);

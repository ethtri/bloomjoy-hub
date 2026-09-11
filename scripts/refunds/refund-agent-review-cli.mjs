import { readFile, writeFile, mkdir, lstat, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { schemaVersion, createReadClient, readPopulation, readCasePacket, readReportHealth, compareReview, paginate, summarizeCasePacket, selectReviewPackets, ReviewError, digest } from './refund-agent-review.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = path.join(root, '.local', 'refund-agent-review');
const args = process.argv.slice(2);
const help = `Read-only refund review (#1089).
node scripts/refunds/refund-agent-review-cli.mjs [--all] [--cohort all|bloomjoy-non-nc] [--case UUID] [--page-size 25]
Environment: SUPABASE_URL, SUPABASE_ANON_KEY (or publishable key), REFUND_REVIEW_ACCESS_TOKEN.
Use an explicitly provided ordinary authenticated user session; no credential discovery or refresh.
The default emits changed cases. --all emits the complete selected cohort.
The bloomjoy-non-nc cohort requires TGPACI_USA_DB ownership evidence and excludes the Adam-managed manual-portal cohort.
--case writes one restricted normalized packet under .local.
No payment, send, case write, provider lookup, or forced ingestion is available.`;

async function safeDirectory(dir) {
  for (const segment of [path.join(root, '.local'), dir]) {
    await mkdir(segment, { recursive: true, mode: 0o700 });
    if ((await lstat(segment)).isSymbolicLink()) throw new ReviewError('unsafe_local_storage');
  }
}
async function save(file, value) {
  try { if ((await lstat(file)).isSymbolicLink()) throw new ReviewError('unsafe_local_storage'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  await rename(temp, file);
}

async function main() {
  if (args.includes('--help')) { console.log(help); return; }
  let caseId; let pageSize = 25; let cohort = 'all'; let emitAll = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--all') emitAll = true;
    else if (args[i] === '--case') caseId = args[++i];
    else if (args[i] === '--page-size') pageSize = Number(args[++i]);
    else if (args[i] === '--cohort') cohort = args[++i];
    else throw new ReviewError('unknown_argument');
  }
  paginate([], 1, pageSize);
  const client = await createReadClient({ url: process.env.SUPABASE_URL, publicKey: process.env.SUPABASE_ANON_KEY, accessToken: process.env.REFUND_REVIEW_ACCESS_TOKEN });
  const population = await readPopulation(client);
  const reportHealth = await readReportHealth(client);
  if (caseId && !population.authorizedIds.has(caseId)) throw new ReviewError('case_outside_current_scope');
  const now = new Date();
  const packets = [];
  // Bounded concurrency, including Done cases with incomplete accounting/notice work.
  for (let i = 0; i < population.cases.length; i += 4) {
    packets.push(...await Promise.all(population.cases.slice(i, i + 4).map(({ row }) => readCasePacket(client, population, row.id, now))));
  }
  // No snapshot commit from mixed population/versions or access lost during enrichment.
  const finalPopulation = await readPopulation(client);
  const populationPin = p => digest(p.cases.map(({ row, queue }) => [row.id, row.updatedAt, row.officialActionVersion,
    row.canPerformOfficialAction, row.lifecycle?.version, row.lifecycle?.managerAction,
    row.lifecycle?.managerQueue, row.lifecycle?.locationEvidence, queue]).sort());
  if (populationPin(population) !== populationPin(finalPopulation)) throw new ReviewError('population_changed_during_read');
  packets.sort((a, b) => a.caseId.localeCompare(b.caseId));
  const selected = selectReviewPackets(packets, cohort);
  const selectedIds = new Set(selected.packets.map(packet => packet.caseId));
  if (caseId && !selectedIds.has(caseId)) throw new ReviewError('case_outside_selected_cohort');
  await safeDirectory(directory);
  const reviewScope = `${client.scope}:${cohort}`;
  const snapshotFile = path.join(directory, `${client.scope}.${cohort}.json`);
  let previous = null;
  try { previous = JSON.parse(await readFile(snapshotFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new ReviewError('snapshot_unreadable'); }
  const review = compareReview(selected.packets, previous, reviewScope);
  const reportFingerprint = digest({ available: reportHealth.available, reason: reportHealth.reason,
    importerStatus: reportHealth.importer?.status, delivery: reportHealth.delivery });
  const reportChanged = previous?.reportFingerprint !== reportFingerprint;
  review.snapshot.reportFingerprint = reportFingerprint;
  let packetFile;
  if (caseId) {
    packetFile = path.join(directory, `${client.scope}-case.json`);
    await save(packetFile, packets.find(packet => packet.caseId === caseId));
  }
  await save(snapshotFile, review.snapshot);
  const changedSelected = review.changed;
  const summaries = (emitAll ? selected.packets : changedSelected).map(summarizeCasePacket);
  const pages = Array.from({ length: Math.ceil(summaries.length / pageSize) }, (_, i) => paginate(summaries, i + 1, pageSize));
  console.log(JSON.stringify({ schemaVersion, status: emitAll
    ? 'complete'
    : (summaries.length || review.removedCount || reportChanged ? 'changed' : 'unchanged'),
    mode: emitAll ? 'full' : 'changes', selection: selected.selection,
    population: population.population, changedCount: changedSelected.length,
    emittedCount: summaries.length, unchangedCount: review.unchangedCount,
    noLongerVisibleCount: review.removedCount, ...(pages.length ? { pages } : {}), ...(packetFile ? { packetFile } : {}),
    ...(reportChanged ? { reportHealth } : {}),
    limitations: 'Initial adapter: attempt history, allocation and per-case report coverage require a scoped read extension. Unknown report or balance does not block a qualified approved first attempt.',
    actionsTaken: { payments: 0, messages: 0, caseWrites: 0, providerCalls: 0 },
  }, null, 2));
}

main().catch(error => {
  // Never print RPC bodies, token material, mail content, raw Error.message or stack.
  console.error(JSON.stringify({ status: 'not_completed', code: error instanceof ReviewError ? error.code : 'review_failed', snapshotAdvanced: false }));
  process.exitCode = 1;
});

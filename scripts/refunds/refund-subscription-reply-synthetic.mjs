import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveSourceBoundFact, validateNoFactReview, validateProposalShape } from './refund-subscription-reply-runner-lib.mjs';

// This offline contract imports no Supabase client, secrets, network transport,
// sender or payment function. It exists to exercise the scheduled Luna task.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixturePath = path.join(root, 'scripts/refunds/fixtures/subscription-reply-synthetic.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
assert.equal(fixture.syntheticOnly, true);
const [command, proposalFile] = process.argv.slice(2);
if (command === 'context') {
  process.stdout.write(`${JSON.stringify(fixture, null, 2)}\n`);
} else if (command === 'validate') {
  const candidate = path.resolve(proposalFile ?? '');
  const outputRoot = path.join(root, 'output');
  assert.ok(candidate.startsWith(`${outputRoot}${path.sep}`), 'proposal_must_be_private_output');
  const proposals = JSON.parse(fs.readFileSync(candidate, 'utf8'));
  assert.ok(Array.isArray(proposals) && proposals.length === 3, 'three_synthetic_proposals_required');
  for (let i = 0; i < fixture.cases.length; i += 1) {
    const context = fixture.cases[i];
    const { scenario, ...proposal } = proposals[i];
    assert.equal(scenario, context.scenario);
    validateProposalShape(proposal);
    if (context.scenario === 'customer_cannot_provide') {
      const result = validateNoFactReview(context, proposal);
      assert.equal(result.reasonCode, 'customer_cannot_provide');
      assert.equal(result.evidenceMessageId, context.sourceMessageId);
    } else {
      const result = deriveSourceBoundFact(context, proposal);
      assert.deepEqual(result.appliedFields, ['amount']);
      assert.equal(result.evidenceMessageId, context.sourceMessageId);
      assert.equal(result.updates.payment_amount_cents,
        context.scenario === 'ordinary_prose_amount' ? 1090 : 700);
    }
  }
  const receipt = {
    syntheticOnly: true, status: 'passed', scenarioCount: fixture.cases.length,
    sourceBoundFacts: 2, groundedNoFactReviews: 1,
    networkCalls: 0, customerMessages: 0, paymentCalls: 0,
  };
  const receiptPath = path.join(outputRoot, 'refund-subscription-reply-synthetic-receipt.json');
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ...receipt, receiptPath })}\n`);
} else {
  throw new Error('usage: context | validate <private-output-proposal.json>');
}

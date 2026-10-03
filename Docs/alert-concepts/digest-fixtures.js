/* Synthetic report snapshots. Cents follow the Hub's canonical, tax-exclusive report basis. */
const digestFixtures = {
  daily: {
    period: 'October 1, 2026', snapshot: 'October 2, 8:00 AM Pacific',
    periodLabel: 'Received October 1', earlierLabel: 'Earlier requests still open',
    coverage: 'Sales: 3 of 4 machines. Refund intake: all 4 machines.',
    machines: [
      { id: 'BJ-014', name: 'Harbor Mall', sales: 42000, transactions: 42, impact: 3000,
        cardReturned: 1090, giftValue: 0,
        cases: [
          { id: 'R-1042', received: 'Oct 1, 2:14 PM', incident: 'Oct 1, about 2:00 PM', reason: 'Charged/paid but no product', comment: 'I paid and the machine started, but no candy came out.', state: 'Your decision', next: '$10.90 card refund prepared. Review in Hub.', open: true, decision: true },
          { id: 'R-1044', received: 'Oct 1, 2:42 PM', incident: 'Oct 1, about 2:30 PM', reason: 'Charged/paid but no product', comment: 'Payment went through, then the machine stopped.', state: 'Bloomjoy is checking', next: 'Purchase research is underway. No manager action needed.', open: true },
          { id: 'R-1045', received: 'Oct 1, 3:20 PM', incident: 'Oct 1, about 3:00 PM', reason: 'Charged/paid but no product', comment: 'Nothing came out after I paid.', state: 'Waiting for customer', next: 'Waiting for one purchase detail. No manager action needed.', open: true },
          { id: 'R-1038', received: 'Sep 30, 11:18 AM', incident: 'Sep 30, about 11:00 AM', reason: 'Product came out incorrectly', comment: 'The candy fell before I could pick it up.', state: 'Your decision', next: '$10.90 card refund prepared. Review in Hub.', open: true, decision: true, earlier: true }
        ] },
      { id: 'BJ-021', name: 'Midtown', sales: 33600, transactions: 35, impact: 800,
        cardReturned: 800, giftValue: 1000,
        cases: [{ id: 'R-1043', received: 'Oct 1, 4:10 PM', incident: 'Oct 1, about 4:00 PM', reason: 'Product came out incorrectly', comment: 'The stick came out with only a little candy on it.', state: 'Your decision', next: '$8.00 card refund prepared. Review in Hub.', open: true, decision: true }] },
      { id: 'BJ-032', name: 'Pine Square', sales: 24000, transactions: 25, impact: 0,
        cardReturned: 0, giftValue: 0, cases: [] },
      { id: 'BJ-061', name: 'West Arcade', sales: null, transactions: null, impact: 0,
        cardReturned: 0, giftValue: 0, cases: [], coverage: 'Sales unavailable for October 1. Refund intake is current.' }
    ]
  },
  weekly: {
    period: 'September 21–27, 2026', snapshot: 'September 28, 8:00 AM Pacific',
    periodLabel: 'Received September 21–27', earlierLabel: 'Earlier requests still open',
    coverage: 'Sales and refund intake: all 4 machines. Comparison: September 14–20.',
    machines: [
      { id: 'BJ-021', name: 'Midtown', sales: 236000, previous: 200000, transactions: 236,
        impact: 2000, cardReturned: 800, giftValue: 2000,
        cases: [
          { id: 'R-1013', received: 'Sep 27, 5:12 PM', incident: 'Sep 27, about 5:00 PM', reason: 'Charged/paid but no product', comment: 'It took my payment but nothing came out.', state: 'Your decision', next: '$10.90 card refund prepared. Review in Hub.', open: true, decision: true },
          { id: 'R-1014', received: 'Sep 25, 3:30 PM', incident: 'Sep 25, about 3:10 PM', reason: 'Product came out incorrectly', comment: 'The candy fell inside the machine.', state: 'Card refund confirmed', next: '$8.00 provider-confirmed refund. No further decision needed.', open: false }
        ] },
      { id: 'BJ-014', name: 'Harbor Mall', sales: 280000, previous: 300000, transactions: 280,
        impact: 3000, cardReturned: 2890, giftValue: 1000,
        cases: [
          { id: 'R-1010', received: 'Sep 22, 1:24 PM', incident: 'Sep 22, about 1:00 PM', reason: 'Charged/paid but no product', comment: 'I paid but the machine did not start.', state: 'Card refund confirmed', next: '$10.90 provider-confirmed refund. No further decision needed.', open: false },
          { id: 'R-1011', received: 'Sep 24, 2:18 PM', incident: 'Sep 24, about 2:00 PM', reason: 'Product came out incorrectly', comment: 'The candy was stuck when I tried to collect it.', state: 'Gift card issued', next: '$10 gift-card value issued. No manager action needed.', open: false },
          { id: 'R-1012', received: 'Sep 26, 4:20 PM', incident: 'Sep 26, about 4:00 PM', reason: 'Charged/paid but no product', comment: 'There was a sound, but no candy came out.', state: 'Waiting for customer', next: 'Waiting for one purchase detail. No manager action needed.', open: true },
          { id: 'R-1008', received: 'Sep 20, 12:10 PM', incident: 'Sep 20, about noon', reason: 'Wrong amount', comment: null, state: 'Bloomjoy is checking', next: 'The original charge is being checked. No manager action needed.', open: true, earlier: true }
        ] },
      { id: 'BJ-032', name: 'Pine Square', sales: 196000, previous: 180000, transactions: 196,
        impact: 1000, cardReturned: 910, giftValue: 0,
        cases: [{ id: 'R-1015', received: 'Sep 27, 6:04 PM', incident: 'Sep 27, about 5:45 PM', reason: 'Charged/paid more than once', comment: 'I saw two charges for the same purchase.', state: 'Bloomjoy is checking', next: 'The payment records are being checked. No manager action needed.', open: true }] },
      { id: 'BJ-061', name: 'West Arcade', sales: 130000, previous: 100000, transactions: 130,
        impact: 0, cardReturned: 0, giftValue: 0, cases: [] }
    ]
  }
};

const money = cents => cents == null ? 'Unavailable' : new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 === 0 ? 0 : 2
}).format(cents / 100);
const delta = (value, prior) => prior > 0 ? `${value >= prior ? '+' : ''}${((value / prior - 1) * 100).toFixed(1)}%` : 'No comparison';
const caseCounts = cases => ({
  fresh: cases.filter(c => !c.earlier).length,
  open: cases.filter(c => c.open).length,
  decisions: cases.filter(c => c.decision).length
});
function digestTotals(key) {
  const data = digestFixtures[key];
  const covered = data.machines.filter(m => m.sales !== null);
  const sum = (rows, field) => rows.reduce((total, m) => total + (m[field] ?? 0), 0);
  return {
    covered: covered.length, machines: data.machines.length,
    sales: sum(covered, 'sales'), impact: sum(covered, 'impact'),
    net: sum(covered, 'sales') - sum(covered, 'impact'),
    transactions: sum(covered, 'transactions'), previous: sum(covered, 'previous'),
    allImpact: sum(data.machines, 'impact'),
    cardReturned: sum(data.machines, 'cardReturned'), giftValue: sum(data.machines, 'giftValue'),
    ...caseCounts(data.machines.flatMap(m => m.cases))
  };
}
function refundRow(c) {
  return `<div class="refund-item" data-case="${c.id}" data-open="${Boolean(c.open)}" data-new="${!c.earlier}">
    <div class="refund-top"><strong>${c.id}</strong><span class="case-state ${c.decision ? 'decision' : ''}">${c.state}</span></div>
    <p class="case-date">Received ${c.received} · Incident reported ${c.incident}</p>
    <p class="case-reason">${c.reason}</p>
    <p class="case-comment">${c.comment ? `“${c.comment}”` : 'No customer comment provided.'}</p>
    <p class="case-next">${c.next}</p>
    <button class="case-link" data-destination="Authenticated exact-case view for ${c.id}, with only the details this recipient is allowed to access.">${c.decision ? 'Review' : 'Open'} ${c.id} ↗</button>
  </div>`;
}
function machineBlock(m, data, key) {
  const counts = caseCounts(m.cases);
  const current = m.cases.filter(c => !c.earlier);
  const earlier = m.cases.filter(c => c.earlier);
  const partial = m.sales === null;
  return `<section class="machine-block ${m.cases.length ? '' : 'compact'}" data-machine="${m.id}">
    <div class="machine-heading"><div><h3>${m.name}</h3><span class="machine-id">${m.id}</span></div><span class="machine-status ${counts.decisions ? 'needs-action' : ''}">${counts.decisions ? `${counts.decisions} ${counts.decisions === 1 ? 'decision' : 'decisions'}` : counts.open ? `${counts.open} open` : partial ? 'Sales unavailable' : 'No open cases'}</span></div>
    ${key === 'weekly' ? `<p class="machine-trend">${delta(m.sales, m.previous)} sales before refunds · Previous week ${money(m.previous)}</p>` : ''}
    <dl class="machine-numbers"><div><dt>Sales before refunds</dt><dd>${money(m.sales)}</dd></div><div><dt>Transactions</dt><dd>${m.transactions ?? 'Unavailable'}</dd></div><div><dt>Period refund impact</dt><dd>${money(m.impact)}</dd></div><div><dt>Sales after period refunds</dt><dd>${partial ? 'Unavailable' : money(m.sales - m.impact)}</dd></div></dl>
    <p class="machine-counts"><strong>${counts.fresh}</strong> new requests · <strong>${counts.open}</strong> open at report time</p>
    ${m.coverage ? `<p class="coverage-note">${m.coverage}</p>` : ''}
    <p class="outcome-line">Card refunds confirmed: ${money(m.cardReturned)} · Gift-card value issued: ${money(m.giftValue)}</p>
    ${current.length ? `<p class="request-group">${data.periodLabel}</p>${current.map(refundRow).join('')}` : '<p class="empty-requests">No new refund requests in this period.</p>'}
    ${earlier.length ? `<p class="request-group earlier">${data.earlierLabel}</p>${earlier.map(refundRow).join('')}` : ''}
  </section>`;
}
function digestBody(key) {
  const data = digestFixtures[key];
  const totals = digestTotals(key);
  const partial = totals.covered < totals.machines;
  return `<div class="digest-summary" data-sales="${totals.sales}" data-transactions="${totals.transactions}" data-impact="${totals.impact}" data-net="${totals.net}" data-new="${totals.fresh}" data-open="${totals.open}">
    <p class="summary-caption">${partial ? 'Known sales subtotal · 3 of 4 machines' : 'All 4 machines · Complete sample periods'}</p>
    <div class="stats four"><div class="stat"><strong>${money(totals.sales)}</strong><span>Sales before refunds</span></div><div class="stat"><strong>${totals.transactions}</strong><span>Transactions</span></div><div class="stat"><strong>${money(totals.impact)}</strong><span>Period refund impact${partial ? ' · same 3 machines' : ''}</span></div><div class="stat"><strong>${money(totals.net)}</strong><span>Sales after period refunds</span></div></div>
    ${key === 'weekly' ? `<p class="total-comparison">${delta(totals.sales, totals.previous)} sales before refunds vs. September 14–20 (${money(totals.previous)})</p>` : ''}
    <p class="digest-counts"><strong>${totals.fresh}</strong> new requests · <strong>${totals.open}</strong> open now · <strong>${totals.decisions}</strong> ${totals.decisions === 1 ? 'decision' : 'decisions'} for you</p>
    <p class="snapshot">Case status as of ${data.snapshot}. New requests use the reporting period.</p>
    <p class="coverage-note">${data.coverage}${partial ? ' Missing sales are excluded, not zero.' : ''}</p>
    <p class="basis-note">Excludes sales tax · USD. Period refund impact uses Hub’s request-period calculation. Confirmed payments below are context, not another deduction.</p>
  </div><h3 class="by-machine-title">Your machines, one by one</h3>
  ${data.machines.map(m => machineBlock(m, data, key)).join('')}
  <p class="outcome-total">Across all 4 machines in this period: ${money(totals.cardReturned)} in confirmed card refunds; ${money(totals.giftValue)} in issued gift-card value. These may resolve older requests.</p>`;
}

export * from '@/data/cateringDessertMenuContract';

export const proposalSections = [
  {
    id: 'service-window',
    number: '01',
    label: 'Service window',
    buyerQuestion: 'When is dessert service expected to open and close?',
    operatorDecision:
      'State arrival, setup, service, last-order, and teardown windows separately enough that the buyer can plan the venue around them.',
    guardrail:
      'A scheduled window describes availability. It does not promise how many guests will be served inside that window.',
  },
  {
    id: 'planning-volume',
    number: '02',
    label: 'Planning volume',
    buyerQuestion: 'What guest or serving estimate should guide supplies and staffing?',
    operatorDecision:
      'Record who supplied the estimate, when it must be updated, and how a material change affects the menu, staff, or scope.',
    guardrail:
      'Call it a planning estimate—not a guaranteed serving count, throughput rate, attendance forecast, or minimum demand.',
  },
  {
    id: 'menu',
    number: '03',
    label: 'Dessert menu',
    buyerQuestion: 'Which one or two choices define the experience?',
    operatorDecision:
      'Name the included menu, how substitutions are handled, when selections lock, and which custom requests sit outside the package.',
    guardrail:
      'Only offer patterns, colors, ingredients, packaging, or service styles the selected equipment and operating plan can support.',
  },
  {
    id: 'staffing',
    number: '04',
    label: 'Staffing',
    buyerQuestion: 'Who owns service, line direction, payment, restock, and breaks?',
    operatorDecision:
      'Name the operator roles included and the buyer or venue roles required. Make any added-staff review trigger visible.',
    guardrail:
      'Do not infer a safe or guaranteed service rate from a machine cycle alone; the complete staffed workflow controls the result.',
  },
  {
    id: 'travel-load-in',
    number: '05',
    label: 'Travel and load-in',
    buyerQuestion: 'Where does included travel end, and what must be true on arrival?',
    operatorDecision:
      'Define the service area or trip basis, parking, access, stairs or elevators, arrival contact, unloading path, and delayed-access response.',
    guardrail:
      'Published machine dimensions or weight do not approve a transport, securing, mounting, or handling method.',
  },
  {
    id: 'power-setup',
    number: '06',
    label: 'Power and setup responsibility',
    buyerQuestion: 'Who provides and approves power, placement, protection, and clearances?',
    operatorDecision:
      'Put the agreed outlet or power source, complete-load review, placement, guest flow, weather protection, and venue sign-off owner in writing.',
    guardrail:
      'Machine volts and watts do not establish generator compatibility, installation approval, outdoor approval, or local acceptance.',
  },
  {
    id: 'payment-deposit',
    number: '07',
    label: 'Payment and deposit posture',
    buyerQuestion: 'What confirms the date, and when is each payment milestone due?',
    operatorDecision:
      'State the chosen deposit or retainer posture, invoice schedule, accepted method, taxes or fees, late-change treatment, and final due point.',
    guardrail:
      'This guide recommends no price, percentage, fee, refundability rule, or earnings target. Use terms reviewed for your business and jurisdiction.',
  },
  {
    id: 'weather',
    number: '08',
    label: 'Weather and operating conditions',
    buyerQuestion: 'Which conditions trigger protection, relocation, pause, or a no-go decision?',
    operatorDecision:
      'Define the decision owner, check time, indoor backup, shelter expectations, and communication path before the event day.',
    guardrail:
      'Do not imply that a venue, tent, forecast, or customer request makes outdoor operation acceptable for the equipment.',
  },
  {
    id: 'cancellation',
    number: '09',
    label: 'Cancellation and reschedule',
    buyerQuestion: 'What happens when the date, scope, venue, access, or conditions change?',
    operatorDecision:
      'Write the notice path, reschedule posture, date-availability rule, scope-change trigger, and treatment of committed costs in your own agreement.',
    guardrail:
      'Present a clear business term, not legal advice. Do not promise that every date or condition can be recovered.',
  },
  {
    id: 'paperwork',
    number: '10',
    label: 'Insurance, COI, and buyer paperwork',
    buyerQuestion: 'Which documents or vendor steps must be complete, and by what deadline?',
    operatorDecision:
      'Ask about certificate-of-insurance wording, additional-insured requests, W-9 or vendor forms, permits, access credentials, purchase orders, and invoice requirements.',
    guardrail:
      'A certificate is evidence requested by a buyer; it is not a Bloomjoy approval, coverage interpretation, permit, or promise of venue acceptance.',
  },
] as const;

export const packageStructures = [
  {
    id: 'fixed-event',
    label: 'Fixed-event structure',
    fit: 'Useful when the buyer wants one understandable scope for a defined date, service window, menu, staffing plan, and setup responsibility.',
    mustDefine: [
      'What the event scope includes and excludes',
      'Which change requests reopen the scope',
      'Travel, access, setup, and teardown boundaries',
      'Payment, weather, cancellation, and paperwork terms',
    ],
    caution:
      '“Fixed” describes the commercial structure, not guaranteed attendance, servings, throughput, operating conditions, or operator cost.',
  },
  {
    id: 'per-serving',
    label: 'Per-serving structure',
    fit: 'Useful when the buyer and operator can agree on what counts as a serving and how the count will be observed without disrupting service.',
    mustDefine: [
      'The exact included serving and counting method',
      'Any planning minimum, cap, or reconciliation process you choose',
      'Who can authorize a change during service',
      'What remains fixed regardless of the final count',
    ],
    caution:
      'A per-serving basis is not a recommendation for a unit price and does not convert an attendance estimate into a sales or serving guarantee.',
  },
] as const;

export const responsibilityLanes = [
  {
    label: 'Operator owns',
    items: [
      'The dessert menu actually offered',
      'Named service and reset roles',
      'Equipment, supplies, cleaning, and teardown inside the agreed scope',
      'The operator’s own pricing, payment, insurance, and contract decisions',
    ],
  },
  {
    label: 'Buyer or venue owns',
    items: [
      'Accurate event, venue, access, and guest-planning information',
      'The on-site contact and agreed arrival path',
      'Buyer-controlled approvals, paperwork, purchase orders, and deadlines',
      'Any promised venue resource assigned to the buyer in writing',
    ],
  },
  {
    label: 'Confirm together',
    items: [
      'Placement, guest flow, power, protection, and load-in responsibility',
      'Service window, menu lock, estimate changes, and scope-change triggers',
      'Weather decision timing and indoor-backup posture',
      'Cancellation, reschedule, COI, and venue-document expectations',
    ],
  },
] as const;

export const packageOutlineFields = [
  ['Package name', '[A clear buyer-facing name for this dessert experience]'],
  ['Event and venue', '[Date, venue, address, buyer contact, access notes]'],
  ['Dessert experience', '[One or two included choices; substitutions and exclusions]'],
  ['Planning estimate', '[Buyer-supplied guest/serving estimate; not a guarantee]'],
  ['Timing', '[Arrival / setup / service / last order / teardown windows]'],
  ['Staffing and flow', '[Operator roles, buyer roles, line and payment responsibility]'],
  ['Travel and load-in', '[Included basis, parking, unloading, access, delay trigger]'],
  ['Power and placement', '[Provider, complete-load review owner, location, protection]'],
  ['Commercial terms', '[Chosen pricing structure, deposit/payment milestones, changes]'],
  ['Weather and changes', '[Decision owner, check time, backup, cancel/reschedule posture]'],
  ['Buyer paperwork', '[COI wording/deadline, W-9, vendor forms, PO, permits, invoicing]'],
  ['Not included', '[Anything the buyer might otherwise assume is part of the package]'],
] as const;

export const cateringPackageOutlineText = `FOOD-TRUCK CATERING DESSERT PACKAGE — WORKING OUTLINE

Template only. Not a Bloomjoy offer, quote, contract, serving promise, or legal recommendation.

Package name:
[A clear buyer-facing name for this dessert experience]

Event and venue:
[Date, venue, address, buyer contact, access notes]

Dessert experience:
[One or two included choices; substitutions and exclusions]

Planning estimate:
[Buyer-supplied guest/serving estimate; not a guarantee]

Timing:
[Arrival / setup / service / last order / teardown windows]

Staffing and flow:
[Operator roles, buyer roles, line and payment responsibility]

Travel and load-in:
[Included basis, parking, unloading, access, delay trigger]

Power and placement:
[Provider, complete-load review owner, location, protection]

Commercial terms:
[Chosen pricing structure, deposit/payment milestones, changes]

Weather and changes:
[Decision owner, check time, backup, cancel/reschedule posture]

Buyer paperwork:
[COI wording/deadline, W-9, vendor forms, PO, permits, invoicing]

Not included:
[Anything the buyer might otherwise assume is part of the package]`;

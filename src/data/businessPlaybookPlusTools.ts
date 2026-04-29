export type PlusToolIcon =
  | "budget"
  | "pitch"
  | "launch"
  | "dailyOps"
  | "venue";

export type BusinessPlaybookPlusTool = {
  id: string;
  title: string;
  categoryLabel: string;
  formatLabel: string;
  description: string;
  bestFor: string;
  icon: PlusToolIcon;
  accentClass: string;
  previewItems: string[];
  samplePreview: string;
  articleLabel: string;
  articleHref: string;
};

export type PlusOperatorExtra = {
  title: string;
  description: string;
  icon: "reporting" | "maintenance" | "certificate";
};

export const businessPlaybookPlusTools: BusinessPlaybookPlusTool[] = [
  {
    id: "startup-budget-worksheet",
    title: "Startup Budget Worksheet",
    categoryLabel: "Budget and Plan",
    formatLabel: "Plus worksheet",
    description:
      "A launch-budget builder for machine, landed-cost questions, accessories, opening supplies, local setup checks, and operating buffer assumptions.",
    bestFor: "Buyers comparing Commercial, Mini, or Micro paths before a quote call.",
    icon: "budget",
    accentClass: "bg-amber/10 text-amber",
    previewItems: [
      "Machine, freight, tariffs, duties, and delivery assumptions",
      "Payment hardware, accessories, sugar, sticks, and event kit lines",
      "Local setup and operating-buffer prompts",
    ],
    samplePreview:
      "Sample row: Freight/import fees - shipping, tariffs, customs duties, brokerage, delivery terms - replace placeholder with landed-cost quote.",
    articleLabel: "Read budget guide",
    articleHref:
      "/resources/business-playbook/startup-budget-checklist-cotton-candy-machine-business",
  },
  {
    id: "location-pitch-script",
    title: "Location Pitch Script",
    categoryLabel: "Find Locations",
    formatLabel: "Plus script",
    description:
      "A practical owner-facing pitch framework with opener, venue-benefit notes, objection prompts, and follow-up language.",
    bestFor: "Commercial placement prospects preparing for a venue conversation.",
    icon: "pitch",
    accentClass: "bg-sage-light text-sage",
    previewItems: [
      "Owner opener and venue-fit proof points",
      "Questions for footprint, power, and support",
      "Follow-up note after a site walk",
    ],
    samplePreview:
      "Sample opener: We help family venues add a small guest-experience moment without adding a new staff station.",
    articleLabel: "Read pitch guide",
    articleHref: "/resources/business-playbook/how-to-pitch-location-owners",
  },
  {
    id: "launch-checklist",
    title: "Launch Checklist",
    categoryLabel: "Start the Business",
    formatLabel: "Plus checklist",
    description:
      "A first-30-days checklist for quote prep, delivery readiness, supplies, venue communication, and operating rhythm.",
    bestFor: "New operators who want one launch plan instead of scattered notes.",
    icon: "launch",
    accentClass: "bg-primary/10 text-primary",
    previewItems: [
      "Before quote, before delivery, and first-week tasks",
      "Venue and support contact checkpoints",
      "Supply, payment, cleaning, and escalation reminders",
    ],
    samplePreview:
      "Sample task: Before delivery, confirm placement, power, service access, venue contact, and opening supply storage.",
    articleLabel: "Read launch guide",
    articleHref:
      "/resources/business-playbook/how-to-start-cotton-candy-vending-business",
  },
  {
    id: "daily-operating-checklist",
    title: "Daily Operating Checklist",
    categoryLabel: "Operator Routine",
    formatLabel: "Plus job aid",
    description:
      "A daily task card for restock, visual inspection, wipe-downs, payment checks, issue notes, and venue follow-up.",
    bestFor: "Operators who want a repeatable routine after the machine is live.",
    icon: "dailyOps",
    accentClass: "bg-rose/10 text-rose",
    previewItems: [
      "Open, mid-day, and close checks",
      "Cleaning, refill, and payment review prompts",
      "Issue log and owner check-in reminders",
    ],
    samplePreview:
      "Sample check: Wipe visible surfaces, confirm sugar/stick levels, test payment flow, and note anything the venue mentioned.",
    articleLabel: "Compare operating paths",
    articleHref: "/resources/business-playbook/commercial-vending-vs-event-catering",
  },
  {
    id: "venue-evaluation-worksheet",
    title: "Venue Evaluation Worksheet",
    categoryLabel: "Find Locations",
    formatLabel: "Plus scorecard",
    description:
      "A site-walk worksheet for scoring dwell time, visibility, power, access, service rhythm, and owner readiness.",
    bestFor: "Commercial operators choosing which locations deserve serious follow-up.",
    icon: "venue",
    accentClass: "bg-charcoal/10 text-charcoal",
    previewItems: [
      "Dwell time, traffic, and guest-fit scoring",
      "Placement, power, and maintenance access notes",
      "Owner readiness and next-action prompt",
    ],
    samplePreview:
      "Sample score row: Dwell time 1-5 - do families wait, browse, line up, or pause within sight of the machine?",
    articleLabel: "Read location guide",
    articleHref:
      "/resources/business-playbook/best-locations-for-cotton-candy-vending-machines",
  },
];

export const plusOperatorExtras: PlusOperatorExtra[] = [
  {
    title: "Connected Reporting Views",
    description:
      "Assigned-machine sales, trends, and exports when reporting has been enabled for the account.",
    icon: "reporting",
  },
  {
    title: "Maintenance References",
    description:
      "Cleaning, hygiene, troubleshooting, and function-check references for live operators.",
    icon: "maintenance",
  },
  {
    title: "Operator Certificate",
    description:
      "Operator Essentials completion path for members who finish the required training flow.",
    icon: "certificate",
  },
];

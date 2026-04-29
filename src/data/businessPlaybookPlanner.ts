export type PlannerMachineId = "commercial" | "mini" | "micro";

export type PlannerBudgetKey =
  | "machine"
  | "importFreight"
  | "accessoriesPayment"
  | "deliverySetup"
  | "openingSupplies"
  | "localReadiness"
  | "operatingBuffer";

export type PlannerBudget = Record<PlannerBudgetKey, number>;

export type PlannerMachineProfile = {
  id: PlannerMachineId;
  label: string;
  shortLabel: string;
  contactInterest: string;
  bestFor: string;
  watchOut: string;
  articleHref: string;
  articleLabel: string;
  colorClass: string;
  defaultBudget: PlannerBudget;
};

export type PlannerQuestionId =
  | "path"
  | "setting"
  | "service"
  | "pattern"
  | "ops";

export type PlannerChoice = {
  id: string;
  label: string;
  helper: string;
  weights: Record<PlannerMachineId, number>;
};

export type PlannerQuestion = {
  id: PlannerQuestionId;
  label: string;
  helper: string;
  choices: PlannerChoice[];
};

export const plannerPath = "/resources/business-playbook/planner";

export const plannerMachineProfiles: Record<PlannerMachineId, PlannerMachineProfile> = {
  commercial: {
    id: "commercial",
    label: "Commercial Machine",
    shortLabel: "Commercial",
    contactInterest: "commercial",
    bestFor:
      "Permanent or semi-permanent placements where visibility, repeat traffic, and self-service novelty matter.",
    watchOut:
      "Commercial planning depends heavily on venue fit, delivery, power, service access, and the owner conversation.",
    articleHref:
      "/resources/business-playbook/best-locations-for-cotton-candy-vending-machines",
    articleLabel: "Read the location guide",
    colorClass: "bg-primary/10 text-primary",
    defaultBudget: {
      machine: 0,
      importFreight: 0,
      accessoriesPayment: 350,
      deliverySetup: 800,
      openingSupplies: 450,
      localReadiness: 500,
      operatingBuffer: 750,
    },
  },
  mini: {
    id: "mini",
    label: "Mini Machine",
    shortLabel: "Mini",
    contactInterest: "mini",
    bestFor:
      "Portable event service, small venues, catering tests, and operators who expect to staff the experience.",
    watchOut:
      "Mini can be flexible, but you still need a plan for transport, event setup, supplies, and staff rhythm.",
    articleHref:
      "/resources/business-playbook/mini-micro-event-catering-business-guide",
    articleLabel: "Read the event guide",
    colorClass: "bg-sage-light text-sage",
    defaultBudget: {
      machine: 4000,
      importFreight: 0,
      accessoriesPayment: 250,
      deliverySetup: 350,
      openingSupplies: 250,
      localReadiness: 300,
      operatingBuffer: 400,
    },
  },
  micro: {
    id: "micro",
    label: "Micro Machine",
    shortLabel: "Micro",
    contactInterest: "micro",
    bestFor:
      "Compact, low-volume starts where basic shapes are enough and the goal is to validate demand.",
    watchOut:
      "Micro is intentionally simple. If complex patterns or higher-throughput events matter, compare Mini or Commercial.",
    articleHref: "/resources/business-playbook/commercial-vending-vs-event-catering",
    articleLabel: "Compare operating paths",
    colorClass: "bg-amber/10 text-amber",
    defaultBudget: {
      machine: 2200,
      importFreight: 0,
      accessoriesPayment: 200,
      deliverySetup: 200,
      openingSupplies: 150,
      localReadiness: 250,
      operatingBuffer: 300,
    },
  },
};

export const plannerQuestions: PlannerQuestion[] = [
  {
    id: "path",
    label: "What are you trying to build first?",
    helper: "Pick the path that sounds closest, even if you expect it to evolve.",
    choices: [
      {
        id: "venue-placement",
        label: "A vending placement in a venue",
        helper: "Malls, arcades, family entertainment centers, attractions, or similar locations.",
        weights: { commercial: 5, mini: 1, micro: 0 },
      },
      {
        id: "events-catering",
        label: "An event or catering offer",
        helper: "Parties, corporate events, fairs, school events, and pop-ups.",
        weights: { commercial: 1, mini: 5, micro: 2 },
      },
      {
        id: "small-test",
        label: "A smaller test before going bigger",
        helper: "Validate interest, learn operations, and keep the first setup compact.",
        weights: { commercial: 0, mini: 2, micro: 5 },
      },
    ],
  },
  {
    id: "setting",
    label: "Where will people discover it?",
    helper: "The setting determines how much the machine needs to sell the moment by itself.",
    choices: [
      {
        id: "high-traffic",
        label: "High-traffic public location",
        helper: "The machine needs to catch attention and operate with a repeatable service rhythm.",
        weights: { commercial: 5, mini: 1, micro: 0 },
      },
      {
        id: "staffed-event",
        label: "Staffed event table or booth",
        helper: "A person can explain, manage flow, and make the experience feel hosted.",
        weights: { commercial: 1, mini: 5, micro: 2 },
      },
      {
        id: "small-private",
        label: "Small private or low-volume setting",
        helper: "The machine is more of a compact attraction than a full commercial installation.",
        weights: { commercial: 0, mini: 2, micro: 5 },
      },
    ],
  },
  {
    id: "service",
    label: "How do you want to operate it?",
    helper: "Think about who checks supplies, answers questions, and handles setup.",
    choices: [
      {
        id: "placement-routine",
        label: "A repeatable location routine",
        helper: "Visit, restock, clean, check performance, and keep the venue owner comfortable.",
        weights: { commercial: 5, mini: 1, micro: 0 },
      },
      {
        id: "show-up-staffed",
        label: "Show up, staff it, pack it down",
        helper: "Your workflow looks more like event operations than vending operations.",
        weights: { commercial: 1, mini: 5, micro: 2 },
      },
      {
        id: "learn-light",
        label: "Keep the learning curve light",
        helper: "You want a simpler first operating rhythm before expanding.",
        weights: { commercial: 0, mini: 2, micro: 5 },
      },
    ],
  },
  {
    id: "pattern",
    label: "How important are complex patterns?",
    helper: "This is one of the clearest product-fit signals.",
    choices: [
      {
        id: "full-library",
        label: "Very important",
        helper: "The full visual draw and deeper pattern set are part of the business case.",
        weights: { commercial: 5, mini: 3, micro: 0 },
      },
      {
        id: "most-patterns",
        label: "Important, but portability matters too",
        helper: "You want a stronger pattern set without committing to a full-size placement.",
        weights: { commercial: 2, mini: 5, micro: 0 },
      },
      {
        id: "basic-shapes",
        label: "Basic shapes are fine",
        helper: "You are optimizing for entry price, compactness, or a simple test.",
        weights: { commercial: 0, mini: 1, micro: 5 },
      },
    ],
  },
  {
    id: "ops",
    label: "What feels like the hardest part right now?",
    helper: "Your biggest concern points to the next article or quote conversation.",
    choices: [
      {
        id: "finding-location",
        label: "Finding and pitching a location",
        helper: "You need a strong venue story, owner pitch, and site-readiness plan.",
        weights: { commercial: 5, mini: 1, micro: 0 },
      },
      {
        id: "booking-events",
        label: "Booking and running events",
        helper: "Your biggest lift is packaging the offer, pricing, and event-day flow.",
        weights: { commercial: 1, mini: 5, micro: 2 },
      },
      {
        id: "budget-confidence",
        label: "Getting comfortable with budget",
        helper: "You need a clear first plan before committing to a larger operating model.",
        weights: { commercial: 1, mini: 2, micro: 5 },
      },
    ],
  },
];

export const plannerBudgetLabels: Record<
  PlannerBudgetKey,
  { label: string; helper: string }
> = {
  machine: {
    label: "Machine quote or list price",
    helper: "Use the quoted amount when available. Commercial pricing is quote-led.",
  },
  importFreight: {
    label: "Freight, tariffs, duties, and import fees",
    helper:
      "Use the actual landed-cost quote if these are not already included. Ask about shipping from China, customs duties, tariffs, brokerage, and delivery terms.",
  },
  accessoriesPayment: {
    label: "Accessories and payment hardware",
    helper:
      "Card reader or payment hardware, mounting needs, signage, spare tools, extension cords, bins, cases, or event-table gear.",
  },
  deliverySetup: {
    label: "Delivery and setup prep",
    helper:
      "Local delivery, site prep, transport, liftgate or access needs, booth setup, or launch-day setup materials.",
  },
  openingSupplies: {
    label: "Opening sugar, sticks, and supplies",
    helper:
      "Sugar, paper sticks, bags or cones if used, cleaning supplies, first restock cushion, and guest-facing basics.",
  },
  localReadiness: {
    label: "Local readiness checks",
    helper: "Use this as a planning placeholder for entity, banking, insurance, permits, or professional advice.",
  },
  operatingBuffer: {
    label: "Operating buffer",
    helper: "A cushion for early restocks, travel, replacement items, and unexpected setup needs.",
  },
};

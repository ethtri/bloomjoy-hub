import { DESSERT_COMPARISON_CITATION_URLS } from '@/data/dessertAddOnComparisonContract';

export * from '@/data/dessertAddOnComparisonContract';

export type DessertOptionId =
  | 'cotton-candy'
  | 'baked-treats'
  | 'fried-desserts'
  | 'frozen-desserts'
  | 'fresh-fruit';

export type ComparisonPosture = 'advantage' | 'confirm' | 'heavier';

export const comparisonPostureLabels: Record<ComparisonPosture, string> = {
  advantage: 'Potential advantage',
  confirm: 'Confirm the plan',
  heavier: 'Heavier obligation',
};

export const dessertOptions: readonly {
  id: DessertOptionId;
  name: string;
  shortName: string;
  positioning: string;
  likelyFit: string;
  watch: string;
}[] = [
  {
    id: 'cotton-candy',
    name: 'Robotic cotton candy',
    shortName: 'Cotton candy',
    positioning: 'A made-to-order visual experience built around a machine and dry inputs.',
    likelyFit:
      'A staffed service window can support measured machine space, a reviewed total electrical load, guest flow, and cleaning/reset ownership.',
    watch:
      'Machine clearance, power, manual-versus-automatic stick flow, weather response, and transport questions must be resolved without treating Bloomjoy as the approving authority.',
  },
  {
    id: 'baked-treats',
    name: 'Cookies and brownies',
    shortName: 'Baked treats',
    positioning: 'A familiar grab-and-go category that can be produced elsewhere or bought finished.',
    likelyFit:
      'The truck wants fast handoff, compact display, and a product that can arrive portioned or packaged under an approved operating plan.',
    watch:
      'Recipe, fillings, supplier, allergen, labeling, holding, and unsold-inventory requirements can change the apparently simple setup.',
  },
  {
    id: 'fried-desserts',
    name: 'Churros and fried desserts',
    shortName: 'Fried desserts',
    positioning: 'A fresh-cooked sensory product with a materially larger cooking and fire-safety footprint.',
    likelyFit:
      'The existing mobile operation already supports the reviewed cooking equipment, ventilation/fire protection, oil handling, staffing, and cleaning workflow.',
    watch:
      'Adding hot-oil cooking can change equipment, fire-protection, plan-review, training, waste, and venue obligations.',
  },
  {
    id: 'frozen-desserts',
    name: 'Ice cream and frozen desserts',
    shortName: 'Frozen desserts',
    positioning: 'A familiar category whose core operating constraint is the uninterrupted frozen or cold chain.',
    likelyFit:
      'The vehicle already has suitable reviewed cold equipment, monitoring, inventory space, service flow, and a response to power interruption.',
    watch:
      'Freezer footprint, concurrent electrical load, temperature control, melt loss, restocking, and hot-weather demand on equipment remain central.',
  },
  {
    id: 'fresh-fruit',
    name: 'Fresh fruit cups and skewers',
    shortName: 'Fresh fruit',
    positioning: 'A colorful fresh option that trades cooking equipment for preparation and cold-holding work.',
    likelyFit:
      'The operator already has an approved produce-prep, handwashing, food-protection, cold-holding, inventory, and discard plan.',
    watch:
      'Fresh-cut ingredients can introduce time/temperature control, cross-contamination, short-hold, and spoilage questions that whole produce does not.',
  },
] as const;

type ComparisonRow = {
  dessert: DessertOptionId;
  posture: ComparisonPosture;
  summary: string;
};

export const dessertComparisonCriteria: readonly {
  id: string;
  title: string;
  question: string;
  rows: readonly ComparisonRow[];
}[] = [
  {
    id: 'prep',
    title: 'Prep before service',
    question: 'What has to happen before the first order can leave the window?',
    rows: [
      { dessert: 'cotton-candy', posture: 'confirm', summary: 'Stage the machine, approved sugar and sticks, payment/guest flow, cleaning tools, and the intended pattern menu.' },
      { dessert: 'baked-treats', posture: 'advantage', summary: 'Finished and portioned products can make onboard prep light; recipe, supplier, packaging, and holding still govern the plan.' },
      { dessert: 'fried-desserts', posture: 'heavier', summary: 'Dough or batter, oil, toppings, cooking equipment, warm-up, and shutdown steps create a longer opening sequence.' },
      { dessert: 'frozen-desserts', posture: 'confirm', summary: 'Inventory must be loaded and held in the intended cold equipment before service, with utensils and toppings staged.' },
      { dessert: 'fresh-fruit', posture: 'heavier', summary: 'Washing, cutting, portioning, food-contact sanitation, and protected cold storage can move meaningful work before service.' },
    ],
  },
  {
    id: 'cold-storage',
    title: 'Cold storage',
    question: 'Does the core menu depend on refrigerated or frozen holding?',
    rows: [
      { dessert: 'cotton-candy', posture: 'advantage', summary: 'Core sugar and sticks use protected dry storage rather than a cold chain; toppings or adjacent menu items may change that.' },
      { dessert: 'baked-treats', posture: 'advantage', summary: 'Some finished recipes can use protected ambient storage, while dairy fillings, toppings, or local rules may require another plan.' },
      { dessert: 'fried-desserts', posture: 'confirm', summary: 'The finished item is cooked, but dough, batter, sauces, or toppings may still require temperature control.' },
      { dessert: 'frozen-desserts', posture: 'heavier', summary: 'The product and service quality rely on continuous frozen or cold holding and monitored equipment.' },
      { dessert: 'fresh-fruit', posture: 'heavier', summary: 'Fresh-cut ingredients may require time/temperature control; the exact fruit and preparation method matter.' },
    ],
  },
  {
    id: 'cooking',
    title: 'Cooking and frying',
    question: 'What active cooking system becomes part of the mobile operation?',
    rows: [
      { dessert: 'cotton-candy', posture: 'advantage', summary: 'The electrical machine heats and spins sugar, but the category does not add a deep fryer or open-flame cook line.' },
      { dessert: 'baked-treats', posture: 'advantage', summary: 'Finished products avoid onboard cooking; baking or reheating on the truck changes this posture.' },
      { dessert: 'fried-desserts', posture: 'heavier', summary: 'Active frying adds hot oil, cooking controls, fire protection, ventilation questions, and a larger cleaning/shutdown job.' },
      { dessert: 'frozen-desserts', posture: 'advantage', summary: 'Ready-to-serve frozen products typically avoid onboard cooking, though safe handling and cold equipment remain.' },
      { dessert: 'fresh-fruit', posture: 'advantage', summary: 'No cooking is inherent, but cutting, utensil sanitation, handwashing, and food protection still belong in the plan.' },
    ],
  },
  {
    id: 'power',
    title: 'Electrical and fuel load',
    question: 'What new concurrent load must the complete setup support?',
    rows: [
      { dessert: 'cotton-candy', posture: 'confirm', summary: 'Use the selected machine’s published rating inside a complete-load review; volts and watts alone do not approve a generator.' },
      { dessert: 'baked-treats', posture: 'advantage', summary: 'A finished grab-and-go format can add little equipment load; onboard baking, warming, or refrigeration changes the answer.' },
      { dessert: 'fried-desserts', posture: 'heavier', summary: 'Electric or fuel-fired cooking, ventilation, fire protection, and holding equipment must be reviewed as one operating system.' },
      { dessert: 'frozen-desserts', posture: 'heavier', summary: 'Freezer or refrigeration load is continuous and must be planned alongside startup demand and the truck’s other equipment.' },
      { dessert: 'fresh-fruit', posture: 'confirm', summary: 'Cold holding, lighting, and prep equipment may add load even when the menu does not cook.' },
    ],
  },
  {
    id: 'footprint',
    title: 'Footprint and access',
    question: 'What stays usable after equipment, storage, staff, and the guest line are counted?',
    rows: [
      { dessert: 'cotton-candy', posture: 'confirm', summary: 'Match the exact machine envelope to doors, load-in, operator/service clearance, cleaning access, and guest flow.' },
      { dessert: 'baked-treats', posture: 'advantage', summary: 'Portioned inventory can fit in compact protected bins or display, subject to actual volume and holding requirements.' },
      { dessert: 'fried-desserts', posture: 'heavier', summary: 'Cooking, landing, oil, ventilation/fire protection, utensil, and cleaning zones compete for working space.' },
      { dessert: 'frozen-desserts', posture: 'heavier', summary: 'Freezer, dipping or dispensing, toppings, utensil, and restock access can create a substantial fixed footprint.' },
      { dessert: 'fresh-fruit', posture: 'confirm', summary: 'Cold storage, protected display, prep surfaces, utensils, and waste must fit the actual service model.' },
    ],
  },
  {
    id: 'service-rhythm',
    title: 'Service rhythm',
    question: 'Is the dessert picked up, portioned, cooked, or made one order at a time?',
    rows: [
      { dessert: 'cotton-candy', posture: 'confirm', summary: 'It is a made-to-order visual cycle. Pattern, stick flow, payment, guests, resets, and staffing prevent a guaranteed served rate.' },
      { dessert: 'baked-treats', posture: 'advantage', summary: 'Pre-portioned items support a fast handoff when ordering, payment, packaging, and inventory are already organized.' },
      { dessert: 'fried-desserts', posture: 'confirm', summary: 'Fresh cooking can create queues or batching decisions; the equipment and menu determine the real rhythm.' },
      { dessert: 'frozen-desserts', posture: 'confirm', summary: 'Scooping, dispensing, toppings, payment, and cold-equipment recovery shape service more than the category name does.' },
      { dessert: 'fresh-fruit', posture: 'advantage', summary: 'Pre-portioned cups or skewers can be quick to hand off; made-to-order cutting or assembly changes the workflow.' },
    ],
  },
  {
    id: 'staffing',
    title: 'Staffing and training',
    question: 'Which role must exist for the dessert to run without disrupting the core menu?',
    rows: [
      { dessert: 'cotton-candy', posture: 'confirm', summary: 'Mini needs trained manual stick feeding. Commercial dispenses sticks automatically, but payment, monitoring, restock, cleaning, and shutdown still need owners.' },
      { dessert: 'baked-treats', posture: 'advantage', summary: 'A packaged handoff can fit an existing cashier role, though allergen questions, restock, and inventory still need clear ownership.' },
      { dessert: 'fried-desserts', posture: 'heavier', summary: 'A trained cooking role must manage hot oil, timing, guest flow, cleaning, and safe opening/shutdown procedures.' },
      { dessert: 'frozen-desserts', posture: 'confirm', summary: 'Portioning, topping, utensil sanitation, restock, and temperature checks add repeatable service tasks.' },
      { dessert: 'fresh-fruit', posture: 'confirm', summary: 'Preparation, cold holding, utensil sanitation, allergen/cross-contact awareness, and discard decisions require ownership.' },
    ],
  },
  {
    id: 'waste',
    title: 'Spoilage and waste',
    question: 'What becomes unsellable when demand, weather, or equipment does not follow the plan?',
    rows: [
      { dessert: 'cotton-candy', posture: 'confirm', summary: 'Dry inputs can be staged, but malformed products, open-service exposure, cleaning debris, and unused toppings still create waste.' },
      { dessert: 'baked-treats', posture: 'confirm', summary: 'Prepared inventory has a recipe- and supplier-specific hold window; overproduction and damaged packaging remain operator risks.' },
      { dessert: 'fried-desserts', posture: 'heavier', summary: 'Oil management, prepared dough or batter, cooked hold time, toppings, and shutdown disposal add waste decisions.' },
      { dessert: 'frozen-desserts', posture: 'confirm', summary: 'A stable frozen chain protects inventory; melt, equipment failure, and repeated temperature excursions can create loss.' },
      { dessert: 'fresh-fruit', posture: 'heavier', summary: 'Cut inventory has a shorter usable window and can require discard when time, temperature, or food-protection controls fail.' },
    ],
  },
  {
    id: 'weather',
    title: 'Weather sensitivity',
    question: 'How does heat, humidity, wind, rain, or a power interruption change service?',
    rows: [
      { dessert: 'cotton-candy', posture: 'heavier', summary: 'A protected weather and humidity response is essential; Bloomjoy does not approve outdoor use or a universal operating condition.' },
      { dessert: 'baked-treats', posture: 'advantage', summary: 'Protected packaged items can be comparatively resilient, while heat-sensitive coatings, fillings, and food protection may still matter.' },
      { dessert: 'fried-desserts', posture: 'confirm', summary: 'Wind, rain, ambient heat, ventilation, and safe shutdown can affect a cooking station, especially when it operates adjacent to the vehicle.' },
      { dessert: 'frozen-desserts', posture: 'heavier', summary: 'Hot weather and power interruption put direct pressure on equipment recovery, product condition, and safe holding.' },
      { dessert: 'fresh-fruit', posture: 'heavier', summary: 'Heat and sun increase the importance of protected display, cold holding, monitoring, and a discard plan.' },
    ],
  },
  {
    id: 'portability',
    title: 'Portability and load-in',
    question: 'What must be moved, secured, oriented, and made ready at each service location?',
    rows: [
      { dessert: 'cotton-candy', posture: 'heavier', summary: 'Published weight and dimensions do not establish safe handling, vehicle mounting, securing, or transport orientation for a machine.' },
      { dessert: 'baked-treats', posture: 'advantage', summary: 'Protected trays, bins, or packages can be portable when the actual food-protection and holding plan is approved.' },
      { dessert: 'fried-desserts', posture: 'heavier', summary: 'Cooking equipment, oil, fuel or electrical connections, fire protection, cooling, and cleaning complicate movement and shutdown.' },
      { dessert: 'frozen-desserts', posture: 'heavier', summary: 'Cold equipment, inventory, electrical continuity, and temperature monitoring must remain controlled through travel and setup.' },
      { dessert: 'fresh-fruit', posture: 'confirm', summary: 'Coolers or cold equipment, protected food, prep tools, display, and waste are portable only as a complete controlled system.' },
    ],
  },
  {
    id: 'visual-draw',
    title: 'Visual draw',
    question: 'Does the guest see an experience, a display, or only the finished item?',
    rows: [
      { dessert: 'cotton-candy', posture: 'advantage', summary: 'The robotic formation process is part of the product experience, especially when the line can see it without blocking service.' },
      { dessert: 'baked-treats', posture: 'confirm', summary: 'Display, decoration, packaging, or a finishing step can add visual interest; a plain grab-and-go setup may rely more on familiarity.' },
      { dessert: 'fried-desserts', posture: 'advantage', summary: 'Fresh cooking, finishing, and aroma can create a visible moment, paired with the larger cooking obligation.' },
      { dessert: 'frozen-desserts', posture: 'confirm', summary: 'Color, toppings, dipping, or dispensing can be visual, but the base category is also familiar and widely understood.' },
      { dessert: 'fresh-fruit', posture: 'advantage', summary: 'Color and presentation can read clearly from a display, provided food protection and temperature control are maintained.' },
    ],
  },
  {
    id: 'catering',
    title: 'Catering fit',
    question: 'Can the dessert be described as a clear service window or package responsibility?',
    rows: [
      { dessert: 'cotton-candy', posture: 'advantage', summary: 'A staffed visual service window can be proposal-friendly when setup, power, staffing, menu, and venue responsibilities are explicit.' },
      { dessert: 'baked-treats', posture: 'advantage', summary: 'Boxed counts, platters, favors, or guest pickup can create a simple responsibility boundary without a live cook line.' },
      { dessert: 'fried-desserts', posture: 'confirm', summary: 'Fresh service can be compelling, but the venue must support the cooking, fire-safety, ventilation, load-in, and cleanup plan.' },
      { dessert: 'frozen-desserts', posture: 'confirm', summary: 'It can support a staffed dessert station when cold equipment, power, inventory, service, and weather responsibilities are assigned.' },
      { dessert: 'fresh-fruit', posture: 'advantage', summary: 'Pre-portioned trays, cups, or skewers can fit a proposal, with ingredient, cold-holding, service, and discard assumptions stated.' },
    ],
  },
  {
    id: 'complexity',
    title: 'Overall operating complexity',
    question: 'How many new systems must work at the same time for a reliable service window?',
    rows: [
      { dessert: 'cotton-candy', posture: 'confirm', summary: 'It avoids a cold chain and fryer for core inputs, but adds exact machine fit, power, staff flow, cleaning, weather, and transport questions.' },
      { dessert: 'baked-treats', posture: 'advantage', summary: 'A finished, portioned, protected product can be the lightest operating model in this set; recipe and holding specifics can move it out of that lane.' },
      { dessert: 'fried-desserts', posture: 'heavier', summary: 'Cooking, fire protection, ventilation, oil, staff training, cleaning, and shutdown make this the heaviest general operating posture in the set.' },
      { dessert: 'frozen-desserts', posture: 'heavier', summary: 'Continuous cold equipment, power, inventory condition, monitoring, service, and hot-weather response create an always-on system.' },
      { dessert: 'fresh-fruit', posture: 'confirm', summary: 'No cooking can simplify equipment, but preparation, sanitation, cold holding, short inventory windows, and waste remain active controls.' },
    ],
  },
] as const;

export const dessertComparisonSources = [
  {
    label: 'Bloomjoy published machine facts and approved mobile claim matrix',
    owner: 'Bloomjoy',
    url: DESSERT_COMPARISON_CITATION_URLS[0],
    use: 'Cotton-candy machine footprint, power, stick-flow, cycle-guidance, and claim-boundary inputs.',
  },
  {
    label: '2022 FDA Food Code',
    owner: 'U.S. Food and Drug Administration',
    url: DESSERT_COMPARISON_CITATION_URLS[1],
    use: 'Model-code context for time/temperature control, food protection, equipment, cleaning, and retail food operations. Local adoption must be checked.',
  },
  {
    label: 'Food Truck Safety fact sheet',
    owner: 'National Fire Protection Association',
    url: DESSERT_COMPARISON_CITATION_URLS[2],
    use: 'Fire-protection questions for mobile cooking equipment, grease-laden vapors, fuel, and extinguishing systems.',
  },
  {
    label: 'California Retail Food Code, Chapter 10',
    owner: 'California Legislative Information',
    url: DESSERT_COMPARISON_CITATION_URLS[3],
    use: 'One jurisdiction-specific example of mobile-food plan review, equipment, cleaning, protection, and enforcement-agency authority—not nationwide advice.',
  },
  {
    label: 'Freezing and Food Safety',
    owner: 'USDA Food Safety and Inspection Service',
    url: DESSERT_COMPARISON_CITATION_URLS[4],
    use: 'Frozen-storage, equipment-temperature, power-interruption, and melted-product context.',
  },
  {
    label: 'Fresh-cut fruit and vegetable safety guidance',
    owner: 'U.S. Food and Drug Administration',
    url: DESSERT_COMPARISON_CITATION_URLS[5],
    use: 'Fresh-cut produce temperature control, sanitation, monitoring, and cross-contamination context.',
  },
] as const;

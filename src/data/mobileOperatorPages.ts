export const FOOD_TRUCK_SOLUTION_PATH = '/solutions/food-trucks';
export const MOBILE_SETUP_GUIDE_PATH =
  '/resources/business-playbook/food-truck-mobile-setup-guide';

export const MINI_PURCHASE_PATH = '/machines/mini';
export const commercialFoodTruckQuotePath =
  '/contact?type=quote&interest=commercial&source=%2Fsolutions%2Ffood-trucks&use=mobile-food';

export const foodTruckSolutionFaqs = [
  {
    q: 'Which Bloomjoy machine should a food-truck operator compare first?',
    a: 'Mini is the first model to evaluate for a compact, staffed service concept because it uses manual stick feeding and has published dimensions, weight, power, and planning guidance. That is a starting path, not a compatibility decision. Commercial needs a larger configuration review, and Micro needs confirmation because its public page does not publish the mobile setup specifications needed for this decision.',
  },
  {
    q: 'What is the difference between staffed and automatic stick handling?',
    a: 'Mini requires a trained person to feed each paper stick and manage the guest-service rhythm. The Commercial Machine dispenses sticks automatically. Automatic stick handling does not make a vehicle, trailer, power source, or service plan automatically suitable.',
  },
  {
    q: 'Do the published voltage and wattage prove a generator will work?',
    a: 'No. Published voltage and maximum power are inputs for planning only. They do not prove generator compatibility, safe total electrical load, connection requirements, or suitability for a specific vehicle. Confirm the complete load and approved source with the manufacturer and a qualified electrical professional.',
  },
  {
    q: 'Is an installed truck or trailer setup better than an adjacent station?',
    a: 'They solve different operating problems. An installed setup may simplify guest flow but creates vehicle, securing, access, heat, and local-review questions. An adjacent station separates the machine from the vehicle but still needs approved power, stable placement, weather planning, storage, and a safe service flow.',
  },
  {
    q: 'What can Bloomjoy confirm during a Commercial machine-fit quote?',
    a: 'Commercial is Bloomjoy’s only quoted machine. Bloomjoy can review the intended setting, published Commercial facts, service model, supply path, and the questions that remain. Mini and Micro stay on their payment-first product paths and are not submitted as quote interest. Bloomjoy cannot certify generator compatibility, vehicle mounting or securing, transport orientation, ventilation, outdoor or weather use, venue acceptance, insurance requirements, or permit approval.',
  },
] as const;
export const mobileMachineFacts = [
  {
    id: 'mini',
    name: 'Mini Machine',
    signal: 'First path to evaluate',
    posture: '$4,000 before shipping and final configuration',
    facts: [
      '430 × 555 × 1582 mm; 83.9 kg',
      'AC 110V/220V; 2400W maximum; 100W standby',
      'Manual stick feeding; staffed service required',
      'About 90 seconds per machine cycle; plan roughly 25–35 served/hour with trained staff, not as a guarantee',
    ],
    caveat:
      'Published size, weight, and power do not approve a vehicle, generator, mounting method, or local operating plan.',
    href: '/machines/mini',
  },
  {
    id: 'commercial',
    name: 'Commercial Machine',
    signal: 'Larger reviewed setup',
    posture: 'Quote only; configuration confirmed offline',
    facts: [
      '2001 × 643 × 1315 mm or 2001 × 671 × 1332 mm, depending on configuration',
      'AC 110V/220V; 2700W',
      'Automatic stick dispensing and deeper pattern set',
      '70–130 second machine-cycle guidance; not a served-throughput guarantee',
    ],
    caveat:
      'Configuration, access, power, service flow, and any vehicle or adjacent placement need specific review.',
    href: '/machines/commercial-robotic-machine',
  },
  {
    id: 'micro',
    name: 'Micro Machine',
    signal: 'Basic-shape, lower-volume path',
    posture: '$2,200 before shipping and final configuration',
    facts: [
      'Entry-level robotic cotton candy machine',
      'Basic shapes and lower-volume applications',
      'Public product information does not state the dimensions, weight, power, or mobile service rate needed for setup qualification',
    ],
    caveat:
      'Do not infer mobile compatibility from the product name, price, or qualitative compact-size positioning.',
    href: '/machines/micro',
  },
] as const;

export const mobileSetupChecklist = [
  {
    id: 'space',
    title: 'Measured space and service access',
    prompt:
      'Record usable width, depth, height, door/load-in limits, operator access, cleaning access, and guest line clearance for the exact model.',
    owner: 'Buyer + Bloomjoy review',
  },
  {
    id: 'total-load',
    title: 'Complete electrical-load plan',
    prompt:
      'List the machine maximum power plus refrigeration, cooking, ventilation, payment, lighting, and every other load that may operate at the same time.',
    owner: 'Qualified electrical review',
  },
  {
    id: 'power-source',
    title: 'Approved power source and connection',
    prompt:
      'Confirm voltage, capacity, connection, protection, and operating conditions. Do not treat wattage alone as generator approval.',
    owner: 'Manufacturer + qualified electrical review',
  },
  {
    id: 'load-in',
    title: 'Load-in and handling path',
    prompt:
      'Identify the people, equipment, clearances, route, surface, and timing needed to move the unit without improvising on service day.',
    owner: 'Buyer + vehicle/venue review',
  },
  {
    id: 'transport',
    title: 'Transport, orientation, and securing',
    prompt:
      'Obtain model-specific instructions for transport orientation and securing. Weight and dimensions do not establish a safe method.',
    owner: 'Manufacturer + qualified vehicle professional',
  },
  {
    id: 'environment',
    title: 'Heat, ventilation, weather, and humidity',
    prompt:
      'Confirm the approved operating environment and a stop plan for conditions that affect sugar, electronics, service, or safe placement.',
    owner: 'Manufacturer + venue/local review',
  },
  {
    id: 'storage',
    title: 'Sugar, stick, and spare-supply storage',
    prompt:
      'Plan dry, protected storage and a restock rhythm that does not block food prep, exits, service access, or sanitation work.',
    owner: 'Buyer operating plan',
  },
  {
    id: 'cleaning',
    title: 'Cleaning, reset, and waste path',
    prompt:
      'Identify where daily wipe-downs, debris checks, periodic maintenance, hand hygiene, and waste handling can happen.',
    owner: 'Buyer + manufacturer instructions',
  },
  {
    id: 'service-flow',
    title: 'Staff, payment, and guest line flow',
    prompt:
      'Map who takes payment, who feeds sticks when required, where guests wait, and how service pauses without blocking the core operation.',
    owner: 'Buyer operating plan',
  },
  {
    id: 'local-review',
    title: 'Local, venue, insurer, and authority questions',
    prompt:
      'Confirm which approvals apply to the vehicle, equipment installation, food operation, event site, insurer, fire authority, or enforcement agency.',
    owner: 'Buyer + applicable authorities/professionals',
  },
] as const;

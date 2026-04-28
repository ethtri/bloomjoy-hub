import commercialMachineImage from "@/assets/real/commercial-main.jpg";
import miniMachineImage from "@/assets/real/mini-main.webp";
import microMachineImage from "@/assets/real/micro-main.webp";
import suppliesImage from "@/assets/real/sugar-product.jpg";
import aboutFoundersImage from "@/assets/real/about-founders.webp";
import aboutHeroImage from "@/assets/real/about-hero.jpg";
import landingHeroImage from "@/assets/real/landing-hero.jpg";

export type PlaybookCategoryId =
  | "start"
  | "locations"
  | "budget"
  | "events"
  | "setup";

export type PlaybookTable = {
  caption?: string;
  columns: string[];
  rows: string[][];
};

export type PlaybookScorecardItem = {
  label: string;
  score: string;
  guidance: string;
};

export type PlaybookStep = {
  title: string;
  body: string;
};

export type PlaybookSection = {
  heading: string;
  body: string[];
  bullets?: string[];
  callout?: {
    title: string;
    body: string;
  };
  checklist?: string[];
  table?: PlaybookTable;
  scorecard?: {
    title: string;
    items: PlaybookScorecardItem[];
  };
  steps?: PlaybookStep[];
  script?: {
    title: string;
    lines: string[];
  };
};

export type PlaybookCitation = {
  label: string;
  source: string;
  url: string;
};

export type BusinessPlaybookArticle = {
  slug: string;
  title: string;
  shortTitle: string;
  description: string;
  category: PlaybookCategoryId;
  audience: string;
  machineFit: string;
  updatedAt: string;
  readingTime: string;
  heroImage: string;
  heroImageAlt: string;
  seoImagePath: string;
  visualLabel: string;
  keyTakeaways: string[];
  visualSummary: {
    title: string;
    items: Array<{
      label: string;
      value: string;
      description: string;
    }>;
  };
  primaryCta: {
    label: string;
    href: string;
  };
  secondaryCta?: {
    label: string;
    href: string;
  };
  sections: PlaybookSection[];
  citations: PlaybookCitation[];
  relatedSlugs: string[];
};

export const playbookCategories: Array<{
  id: PlaybookCategoryId;
  title: string;
  description: string;
  colorClass: string;
}> = [
  {
    id: "start",
    title: "Start the Business",
    description:
      "The first-principles guides: model fit, startup path, buyer questions, and launch sequence.",
    colorClass: "bg-primary/10 text-primary",
  },
  {
    id: "locations",
    title: "Find Locations",
    description:
      "How to evaluate venues, pitch owners, and build a location pipeline without sounding generic.",
    colorClass: "bg-sage-light text-sage",
  },
  {
    id: "budget",
    title: "Budget and Plan",
    description:
      "Startup cost categories, opening supplies, operating reserves, and practical planning worksheets.",
    colorClass: "bg-amber/10 text-amber",
  },
  {
    id: "events",
    title: "Events and Catering",
    description:
      "Mini and Micro planning for pop-ups, parties, fairs, staffing, booking, and event-day flow.",
    colorClass: "bg-rose/10 text-rose",
  },
  {
    id: "setup",
    title: "Business Setup",
    description:
      "LLC, EIN, bank account, insurance, permits, and the admin basics new operators should research.",
    colorClass: "bg-charcoal/10 text-charcoal",
  },
];

const sbaStartup: PlaybookCitation = {
  label: "10 steps to start your business",
  source: "U.S. Small Business Administration",
  url: "https://www.sba.gov/business-guide/10-steps-start-your-business",
};

const sbaStructure: PlaybookCitation = {
  label: "Choose a business structure",
  source: "U.S. Small Business Administration",
  url: "https://www.sba.gov/starting-business/choose-your-business-structure/",
};

const irsEin: PlaybookCitation = {
  label: "Employer Identification Number guidance",
  source: "Internal Revenue Service",
  url: "https://www.irs.gov/businesses/employer-identification-number",
};

const googleHelpfulContent: PlaybookCitation = {
  label: "Creating helpful, reliable, people-first content",
  source: "Google Search Central",
  url: "https://developers.google.com/search/docs/fundamentals/creating-helpful-content",
};

export const businessPlaybookArticles: BusinessPlaybookArticle[] = [
  {
    slug: "how-to-start-cotton-candy-vending-business",
    title: "How to Start a Cotton Candy Vending Business",
    shortTitle: "Start a Vending Business",
    description:
      "A practical launch guide for choosing a machine, planning your first locations, budgeting, supplies, setup, and operator rhythm.",
    category: "start",
    audience: "New commercial operators",
    machineFit: "Commercial Machine first, Mini for mobile tests",
    updatedAt: "2026-04-28",
    readingTime: "9 min read",
    heroImage: commercialMachineImage,
    heroImageAlt: "Bloomjoy Commercial Machine ready for a venue placement",
    seoImagePath: "/seo/commercial-machine.jpg",
    visualLabel: "Launch roadmap",
    keyTakeaways: [
      "Start with the business model, not the machine alone.",
      "The best early plan has one target venue type, one launch budget, and one service rhythm.",
      "Bloomjoy can help with machine fit, but local business setup and permits require local research.",
    ],
    visualSummary: {
      title: "A clean first launch has six moving parts",
      items: [
        {
          label: "1",
          value: "Model",
          description: "Choose vending, events, or a hybrid path before comparing machines.",
        },
        {
          label: "2",
          value: "Location",
          description: "Pick a venue type where families already slow down and spend.",
        },
        {
          label: "3",
          value: "Operations",
          description: "Plan refills, cleaning, support, payment, and owner check-ins.",
        },
      ],
    },
    primaryCta: {
      label: "Request a machine quote",
      href: "/contact?type=quote&source=%2Fresources%2Fbusiness-playbook%2Fhow-to-start-cotton-candy-vending-business",
    },
    secondaryCta: {
      label: "Compare machines",
      href: "/machines",
    },
    sections: [
      {
        heading: "Start with the business model",
        body: [
          "A cotton candy machine can be a vending placement, an event attraction, a catering add-on, or a test of a larger venue strategy. The machine is the fun part. The business is the repeatable system around it.",
          "For most new operators, the simplest first question is: do you want a machine that earns from a fixed location, or do you want a portable offer that you bring to events?",
        ],
        table: {
          caption: "Use this to avoid buying for the wrong job.",
          columns: ["Path", "Best machine fit", "What you need to prove"],
          rows: [
            [
              "Fixed-location vending",
              "Commercial Machine",
              "Foot traffic, power access, venue agreement, service schedule",
            ],
            [
              "Events and pop-ups",
              "Mini Machine",
              "Booking demand, staffing flow, transport plan, event pricing",
            ],
            [
              "Low-volume testing",
              "Micro Machine",
              "Basic-shape demand, simple operation, smaller budget fit",
            ],
          ],
        },
      },
      {
        heading: "Build the first 30-day launch plan",
        body: [
          "Do not wait until the machine arrives to figure out where it goes, who checks it, how supplies are ordered, or what happens when something needs support. A calm launch is planned before the crate shows up.",
          "The right v1 plan is not fancy. It is a short operating routine you can actually follow.",
        ],
        steps: [
          {
            title: "Week 1: pick your target venue",
            body: "Choose one primary venue type, like family entertainment centers, tourist retail, malls, arcades, skating rinks, or event venues.",
          },
          {
            title: "Week 2: price the full launch",
            body: "Estimate machine, shipping, opening supplies, insurance, payment setup, permits, signage, and a maintenance reserve.",
          },
          {
            title: "Week 3: secure the first site or booking lane",
            body: "Start outreach with a simple pitch, photos, the service plan, and the reason the machine helps the venue.",
          },
          {
            title: "Week 4: prepare the operating rhythm",
            body: "Write the refill, cleaning, check-in, and issue-escalation routine before your first customer order.",
          },
        ],
      },
      {
        heading: "Choose support before you need support",
        body: [
          "A vending business is easier to run when support boundaries are clear. Technical troubleshooting belongs with manufacturer first-line support. Bloomjoy Plus adds onboarding, playbooks, operator guidance, and concierge help during business hours.",
          "That split matters because it keeps your plan honest. You are not buying a magic box. You are building a small operating system around a very eye-catching machine.",
        ],
        callout: {
          title: "Operator rule of thumb",
          body: "If a task affects machine uptime, write down who owns it before launch: venue staff, your team, manufacturer support, or Bloomjoy concierge.",
        },
        checklist: [
          "Machine placement and power confirmed",
          "Opening sugar and sticks ordered",
          "Payment setup planned",
          "Cleaning and refill owner assigned",
          "WeChat/manufacturer support path understood",
          "Local permits, insurance, and business registration researched",
        ],
      },
      {
        heading: "Use official startup guidance for the admin layer",
        body: [
          "Bloomjoy can help you think through machine fit and operations, but business registration, tax, insurance, and permits vary by location. Treat those as a real part of launch, not a paperwork chore for later.",
          "The SBA recommends thinking through market research, business planning, funding, location, structure, tax IDs, licenses, permits, and banking as part of starting a business. Use that as your admin checklist, then layer your machine plan on top.",
        ],
        bullets: [
          "Decide whether the business will be a solo venture, partnership, LLC, or another structure.",
          "Research state and local registration requirements before applying for an EIN.",
          "Open a business bank account once your registration paperwork is ready.",
          "Ask a local professional about tax, insurance, and permit requirements for your state and venue type.",
        ],
      },
    ],
    citations: [sbaStartup, sbaStructure, irsEin, googleHelpfulContent],
    relatedSlugs: [
      "startup-budget-checklist-cotton-candy-machine-business",
      "best-locations-for-cotton-candy-vending-machines",
      "commercial-vending-vs-event-catering",
    ],
  },
  {
    slug: "best-locations-for-cotton-candy-vending-machines",
    title: "How to Find Good Locations for a Cotton Candy Vending Machine",
    shortTitle: "Find Good Locations",
    description:
      "A practical location scorecard for malls, family entertainment centers, arcades, tourist venues, and other high-attention placements.",
    category: "locations",
    audience: "Commercial vending operators",
    machineFit: "Commercial Machine",
    updatedAt: "2026-04-28",
    readingTime: "8 min read",
    heroImage: landingHeroImage,
    heroImageAlt: "Bloomjoy robotic cotton candy machine in a colorful public setting",
    seoImagePath: "/seo/home-machine.jpg",
    visualLabel: "Venue scorecard",
    keyTakeaways: [
      "The best location is not just busy. It is busy with the right people in the right mood.",
      "Family dwell time, power access, operator access, and venue enthusiasm matter more than raw foot traffic.",
      "A simple scoring rubric helps you compare locations without falling in love with the first yes.",
    ],
    visualSummary: {
      title: "Score locations before you pitch them",
      items: [
        {
          label: "High",
          value: "Dwell time",
          description: "Families pause, browse, wait, or line up nearby.",
        },
        {
          label: "Clean",
          value: "Operations",
          description: "Power, service access, and machine visibility are realistic.",
        },
        {
          label: "Aligned",
          value: "Venue upside",
          description: "The owner sees entertainment value, not just rent.",
        },
      ],
    },
    primaryCta: {
      label: "Explore the Commercial Machine",
      href: "/machines/commercial-robotic-machine",
    },
    secondaryCta: {
      label: "Read the pitch guide",
      href: "/resources/business-playbook/how-to-pitch-location-owners",
    },
    sections: [
      {
        heading: "Look for attention, not just traffic",
        body: [
          "A cotton candy machine is a small show. It works best where people already have permission to be delighted: family entertainment centers, arcades, skating rinks, tourist retail, malls, resorts, cinemas, birthday-party venues, and seasonal attractions.",
          "Raw foot traffic can fool you. A commuter hallway may be packed, but nobody wants to stop. A family entertainment lobby with fewer people can be better because parents are waiting, kids are watching, and the venue already sells fun.",
        ],
        scorecard: {
          title: "Quick location scorecard",
          items: [
            {
              label: "Audience fit",
              score: "1-5",
              guidance: "Families, kids, tourists, or celebration buyers are already present.",
            },
            {
              label: "Dwell time",
              score: "1-5",
              guidance: "People wait, browse, or gather long enough to notice the machine.",
            },
            {
              label: "Visibility",
              score: "1-5",
              guidance: "The machine can face traffic without being tucked behind a corner.",
            },
            {
              label: "Operations",
              score: "1-5",
              guidance: "Power, refill access, cleaning access, and service visits are practical.",
            },
            {
              label: "Venue motivation",
              score: "1-5",
              guidance: "The owner wants a guest experience upgrade, not only a rent check.",
            },
          ],
        },
      },
      {
        heading: "Prioritize these venue types first",
        body: [
          "Start where the product already makes emotional sense. Cotton candy is visual, nostalgic, and kid-friendly. The best placements turn that into a small moment of theater.",
          "If you are new, build a short list by category instead of contacting every business in town.",
        ],
        table: {
          columns: ["Venue type", "Why it can work", "Question to ask"],
          rows: [
            [
              "Family entertainment center",
              "Kids, birthdays, wait time, arcade energy",
              "Where do families wait before or after activities?",
            ],
            [
              "Mall or tourist retail",
              "Foot traffic plus impulse purchases",
              "Can the machine be visible without blocking flow?",
            ],
            [
              "Skating rink or trampoline park",
              "Repeat family visits and party traffic",
              "Who manages party packages and lobby concessions?",
            ],
            [
              "Cinema or attraction lobby",
              "Pre-show waiting and treat mindset",
              "Can the machine operate near existing concessions?",
            ],
          ],
        },
      },
      {
        heading: "Do a site walk before you promise anything",
        body: [
          "A location can sound perfect by email and fail in person. Before signing anything, walk the site like an operator.",
          "Stand where the machine would go. Watch the traffic. Look for outlets. Ask how staff access the area after hours. Find the closest cleaning path. If the machine needs service, can someone reach it without a scavenger hunt?",
        ],
        checklist: [
          "Power access is real, safe, and approved by the venue.",
          "The machine can be serviced without interrupting customers.",
          "The placement is visible from a natural waiting or browsing area.",
          "Venue staff know who to call if there is an issue.",
          "Revenue share, rent, or other commercial terms are clear in writing.",
        ],
      },
    ],
    citations: [sbaStartup],
    relatedSlugs: [
      "how-to-pitch-location-owners",
      "startup-budget-checklist-cotton-candy-machine-business",
      "how-to-start-cotton-candy-vending-business",
    ],
  },
  {
    slug: "mini-micro-event-catering-business-guide",
    title: "How to Start a Cotton Candy Event or Catering Business with Mini or Micro",
    shortTitle: "Event Business Guide",
    description:
      "How to think about bookings, equipment, staffing, packages, transport, and event-day operations for portable cotton candy service.",
    category: "events",
    audience: "Event operators and mobile sellers",
    machineFit: "Mini Machine and Micro Machine",
    updatedAt: "2026-04-28",
    readingTime: "8 min read",
    heroImage: miniMachineImage,
    heroImageAlt: "Bloomjoy Mini Machine for portable event operators",
    seoImagePath: "/seo/mini-machine.jpg",
    visualLabel: "Event-day kit",
    keyTakeaways: [
      "Events are a logistics business with a dessert show attached.",
      "Mini is the stronger fit when pattern capability and event volume matter.",
      "Your offer should be packaged clearly so customers know what they are buying.",
    ],
    visualSummary: {
      title: "Event operators need a portable system",
      items: [
        {
          label: "Offer",
          value: "Packages",
          description: "Sell clear booking packages, not vague hourly availability.",
        },
        {
          label: "Flow",
          value: "Queue",
          description: "Plan the table, line, toppings, sticks, and payment path.",
        },
        {
          label: "Kit",
          value: "Backup",
          description: "Bring supplies, cleaning tools, extension plan, and a recovery checklist.",
        },
      ],
    },
    primaryCta: {
      label: "Explore the Mini Machine",
      href: "/machines/mini",
    },
    secondaryCta: {
      label: "Compare Mini and Micro",
      href: "/resources/business-playbook/commercial-vending-vs-event-catering",
    },
    sections: [
      {
        heading: "Think like an event operator",
        body: [
          "A portable cotton candy business is not only about making candy. It is about showing up on time, setting up cleanly, managing a line, and leaving the customer glad they booked you.",
          "Mini is usually the better event-minded machine when you want more pattern capability and a stronger visual moment. Micro can make sense for smaller, lower-volume, basic-shape use cases.",
        ],
        table: {
          columns: ["Question", "Mini", "Micro"],
          rows: [
            [
              "Do you need complex patterns?",
              "Better fit for more visual variety",
              "Basic shapes only",
            ],
            [
              "Do you expect party or fair volume?",
              "Better fit for more serious event use",
              "Better for smaller, simpler use",
            ],
            [
              "Is budget the main constraint?",
              "Higher machine cost, more capability",
              "Lower entry cost, simpler output",
            ],
          ],
        },
      },
      {
        heading: "Package the offer so buyers understand it",
        body: [
          "People book event vendors when the offer is easy to understand. Instead of saying, 'We have a machine,' build simple packages around time, serving estimate, setup needs, travel, and add-ons.",
          "Keep your first menu short. Too many choices make buyers slower, and slow buyers do not help a new business.",
        ],
        bullets: [
          "Birthday package: fixed service window, simple color menu, local travel radius.",
          "Corporate or school event package: longer service window, invoice-friendly process, setup requirements.",
          "Festival package: booth layout, queue plan, weather policy, staff coverage, and restock plan.",
        ],
        callout: {
          title: "Make the booking page boring in the best way",
          body: "A buyer should know what is included, what costs extra, what you need from them, and what happens if the event changes.",
        },
      },
      {
        heading: "Build the event-day kit",
        body: [
          "The machine is only one part of the setup. Your event kit should make the job feel repeatable even when the venue is chaotic.",
          "Pack like the person who has to solve problems in a parking lot with ten minutes to spare.",
        ],
        checklist: [
          "Sugar and sticks for the expected serving count plus buffer",
          "Cleaning towels and approved cleaning supplies",
          "Table, signage, menu, and line-control plan",
          "Extension/power plan approved by the venue",
          "Payment backup, charger, and printed QR code if used",
          "Trash plan and end-of-event cleanup supplies",
        ],
      },
    ],
    citations: [sbaStartup],
    relatedSlugs: [
      "commercial-vending-vs-event-catering",
      "startup-budget-checklist-cotton-candy-machine-business",
      "business-setup-basics-llc-ein-insurance-permits",
    ],
  },
  {
    slug: "startup-budget-checklist-cotton-candy-machine-business",
    title: "Startup Budget Checklist for a Cotton Candy Machine Business",
    shortTitle: "Startup Budget Checklist",
    description:
      "A practical budget framework for machine cost, supplies, freight, insurance, permits, payment setup, marketing, and operating reserve.",
    category: "budget",
    audience: "Budget-conscious buyers",
    machineFit: "Commercial, Mini, and Micro",
    updatedAt: "2026-04-28",
    readingTime: "7 min read",
    heroImage: suppliesImage,
    heroImageAlt: "Bloomjoy cotton candy sugar and paper sticks for launch planning",
    seoImagePath: "/seo/supplies.jpg",
    visualLabel: "Budget worksheet",
    keyTakeaways: [
      "A launch budget should include more than the machine price.",
      "Opening supplies and a maintenance reserve keep small problems from becoming big surprises.",
      "Your budget should match the business path: fixed vending, events, or a hybrid.",
    ],
    visualSummary: {
      title: "Budget by category, not vibes",
      items: [
        {
          label: "Core",
          value: "Machine",
          description: "The machine plus quoted configuration, shipping, and install assumptions.",
        },
        {
          label: "Launch",
          value: "Supplies",
          description: "Sugar, sticks, cleaning basics, signage, and payment setup.",
        },
        {
          label: "Buffer",
          value: "Reserve",
          description: "Cash set aside for early restock, travel, maintenance, and surprises.",
        },
      ],
    },
    primaryCta: {
      label: "Request a personalized quote",
      href: "/contact?type=quote&source=%2Fresources%2Fbusiness-playbook%2Fstartup-budget-checklist-cotton-candy-machine-business",
    },
    secondaryCta: {
      label: "Shop opening supplies",
      href: "/supplies",
    },
    sections: [
      {
        heading: "The machine price is not the full launch price",
        body: [
          "The fastest way to under-budget is to stop at the machine number. A realistic budget includes everything required to open, operate, restock, and stay compliant.",
          "Your exact numbers depend on machine model, shipping, location, venue terms, supplies, local requirements, and whether you are fixed-location or event-based.",
        ],
        table: {
          caption: "Use this as a planning worksheet, then replace estimates with real quotes.",
          columns: ["Category", "What to include", "Planning note"],
          rows: [
            [
              "Machine",
              "Machine price, add-ons, wrap choices, payment hardware if applicable",
              "Quote-led so final configuration is confirmed before invoicing",
            ],
            [
              "Freight and setup",
              "Shipping, delivery access, liftgate or install assumptions",
              "Ask early if the venue has access constraints",
            ],
            [
              "Opening supplies",
              "Sugar, paper sticks, cleaning basics, backup consumables",
              "Order enough for launch plus buffer",
            ],
            [
              "Business setup",
              "Registration, bank account, insurance, permits, tax support",
              "Varies by state and local rules",
            ],
            [
              "Sales and marketing",
              "Pitch materials, signage, menu, local outreach, event listing",
              "Keep it practical and venue-specific",
            ],
            [
              "Operating reserve",
              "Early restocks, travel, replacement items, support needs",
              "Protects the first few months",
            ],
          ],
        },
      },
      {
        heading: "Match the budget to the path",
        body: [
          "A fixed-location vending budget usually spends more time on venue agreement, placement, service access, payment setup, and reliable restock. An event budget usually spends more time on transport, staffing, table setup, signage, and booking materials.",
          "Do not copy a budget from a different business model unless you want their problems too.",
        ],
        bullets: [
          "Commercial vending: prioritize placement quality, uptime, supplies, and clear service responsibility.",
          "Event business: prioritize transport, event kit, booking workflow, and staff flow.",
          "Hybrid model: budget for both location service and event-day portability before committing.",
        ],
      },
      {
        heading: "Keep a reserve for the unglamorous stuff",
        body: [
          "A reserve is not pessimism. It is how you keep a launch from getting knocked sideways by normal early-business surprises.",
          "Set aside money for the first restock, a missed shipment, extra supplies for a better-than-expected weekend, travel, cleaning replacements, or a venue setup change.",
        ],
        checklist: [
          "Opening sugar and sticks",
          "Cleaning and maintenance supplies",
          "Venue signage or table setup",
          "Payment device or checkout backup",
          "Travel, delivery, or storage costs",
          "Local permits, insurance, or professional advice",
        ],
      },
    ],
    citations: [sbaStartup, sbaStructure],
    relatedSlugs: [
      "how-to-start-cotton-candy-vending-business",
      "business-setup-basics-llc-ein-insurance-permits",
      "mini-micro-event-catering-business-guide",
    ],
  },
  {
    slug: "how-to-pitch-location-owners",
    title: "How to Pitch a Location Owner on a Cotton Candy Vending Machine",
    shortTitle: "Pitch Location Owners",
    description:
      "A practical pitch framework for venue owners: guest experience, space needs, service plan, revenue model, and follow-up script.",
    category: "locations",
    audience: "Operators doing venue outreach",
    machineFit: "Commercial Machine",
    updatedAt: "2026-04-28",
    readingTime: "7 min read",
    heroImage: aboutFoundersImage,
    heroImageAlt: "Bloomjoy team preparing operator materials",
    seoImagePath: "/seo/about.jpg",
    visualLabel: "Pitch script",
    keyTakeaways: [
      "Venue owners care about guest experience, reliability, and operational simplicity.",
      "A good pitch explains the machine, the benefit, the requirements, and the service plan.",
      "Follow-up matters. Many good locations are won after the second useful touch.",
    ],
    visualSummary: {
      title: "A venue pitch needs four proofs",
      items: [
        {
          label: "1",
          value: "Guest draw",
          description: "Show why the machine adds a moment people notice.",
        },
        {
          label: "2",
          value: "Low friction",
          description: "Explain space, power, service visits, and who owns what.",
        },
        {
          label: "3",
          value: "Commercial upside",
          description: "Make the revenue or amenity case simple.",
        },
      ],
    },
    primaryCta: {
      label: "Explore Commercial Machine details",
      href: "/machines/commercial-robotic-machine",
    },
    secondaryCta: {
      label: "Find good locations first",
      href: "/resources/business-playbook/best-locations-for-cotton-candy-vending-machines",
    },
    sections: [
      {
        heading: "Lead with the venue's benefit",
        body: [
          "A location owner is not buying your excitement. They are deciding whether this machine improves their space without creating operational headaches.",
          "Lead with the guest experience and the operating plan. The cotton candy part is memorable, but the owner needs to know it will not become their problem.",
        ],
        script: {
          title: "Simple opening email",
          lines: [
            "Hi [Name], I operate robotic cotton candy machines for family-friendly venues.",
            "I think [Venue] could be a strong fit because guests already spend time near [specific area].",
            "The machine creates a visual treat moment, and I handle the service routine, supplies, and owner check-ins.",
            "Would you be open to a quick walkthrough next week to see if the space, power, and guest flow make sense?",
          ],
        },
      },
      {
        heading: "Bring a one-page plan",
        body: [
          "Do not show up with only enthusiasm. Bring a short plan the venue can react to. The goal is to make the next step obvious.",
          "Your one-pager should be clean enough for the owner to forward to a partner, manager, or landlord without needing you to translate it.",
        ],
        checklist: [
          "Photo of the machine and example placement",
          "Space, power, and access requirements",
          "Service schedule and contact owner",
          "Proposed commercial terms or pilot structure",
          "Why this venue's audience is a good fit",
          "Next step: site walk, pilot date, or decision meeting",
        ],
      },
      {
        heading: "Offer a pilot when the owner is interested but cautious",
        body: [
          "Some venues need to see the machine in context before committing. A pilot can reduce perceived risk if the site logistics are realistic.",
          "Define the pilot terms before you start: duration, placement, service responsibilities, reporting, revenue share or rent, and what success means.",
        ],
        table: {
          columns: ["Owner concern", "Your answer should cover"],
          rows: [
            [
              "Will it take too much staff time?",
              "Who services it, how often, and what staff should do if there is an issue",
            ],
            [
              "Will it fit the space?",
              "Footprint, visibility, customer flow, power, and cleaning access",
            ],
            [
              "Will guests use it?",
              "Audience fit, nearby dwell time, and a short pilot success metric",
            ],
            [
              "How do we make money?",
              "Revenue share, rent, or amenity logic stated simply",
            ],
          ],
        },
      },
    ],
    citations: [sbaStartup],
    relatedSlugs: [
      "best-locations-for-cotton-candy-vending-machines",
      "how-to-start-cotton-candy-vending-business",
      "commercial-vending-vs-event-catering",
    ],
  },
  {
    slug: "commercial-vending-vs-event-catering",
    title: "Commercial Vending vs. Event Catering: Which Cotton Candy Business Fits You?",
    shortTitle: "Vending vs. Events",
    description:
      "Compare fixed-location vending with event and catering operations so you can choose the right machine, budget, and daily workflow.",
    category: "start",
    audience: "Buyers choosing a business path",
    machineFit: "Commercial, Mini, and Micro",
    updatedAt: "2026-04-28",
    readingTime: "6 min read",
    heroImage: microMachineImage,
    heroImageAlt: "Bloomjoy Micro Machine with cotton candy output for smaller setups",
    seoImagePath: "/seo/micro-machine.jpg",
    visualLabel: "Business model comparison",
    keyTakeaways: [
      "Commercial vending is about placement quality and service consistency.",
      "Events are about bookings, logistics, staffing, and guest flow.",
      "The right machine follows the business model, not the other way around.",
    ],
    visualSummary: {
      title: "Two paths, different muscles",
      items: [
        {
          label: "Vending",
          value: "Place",
          description: "Win a site, keep it stocked, keep it clean, keep it earning.",
        },
        {
          label: "Events",
          value: "Move",
          description: "Book dates, show up prepared, serve smoothly, pack out clean.",
        },
        {
          label: "Hybrid",
          value: "Focus",
          description: "Possible later, but harder as a first operating model.",
        },
      ],
    },
    primaryCta: {
      label: "Compare all machines",
      href: "/machines",
    },
    secondaryCta: {
      label: "Read the event guide",
      href: "/resources/business-playbook/mini-micro-event-catering-business-guide",
    },
    sections: [
      {
        heading: "Vending and events are different businesses",
        body: [
          "Both models can use the same basic product category, but they feel very different day to day.",
          "Fixed-location vending rewards patient location development, clear service routes, and reliable restocking. Events reward booking, setup speed, customer flow, and a polished live experience.",
        ],
        table: {
          columns: ["Decision", "Commercial vending", "Event or catering"],
          rows: [
            [
              "Primary challenge",
              "Winning and keeping a good location",
              "Winning bookings and executing event days",
            ],
            [
              "Best machine direction",
              "Commercial Machine",
              "Mini for serious events, Micro for simple low-volume use",
            ],
            [
              "Sales motion",
              "Venue owner outreach and site walks",
              "Event planners, parents, schools, companies, fairs",
            ],
            [
              "Operations rhythm",
              "Scheduled service, restock, cleaning, owner reporting",
              "Transport, setup, line management, teardown",
            ],
          ],
        },
      },
      {
        heading: "Choose the model that fits your personality",
        body: [
          "If you like recurring locations, repeatable service routes, and business-to-business selling, fixed vending may fit you. If you like live events, weekends, direct customer energy, and moving parts, events may feel more natural.",
          "Neither path is automatically easier. They are just different flavors of work.",
        ],
        bullets: [
          "Choose vending if you want to build a location portfolio over time.",
          "Choose events if you are comfortable selling, scheduling, transporting, and staffing.",
          "Choose a hybrid only after the first path is stable enough to not collapse when you add the second.",
        ],
      },
      {
        heading: "Let the business model choose the machine",
        body: [
          "A Commercial Machine is designed for high-throughput, fixed or serious venue use. Mini is designed for operators who need a more portable footprint and still want stronger pattern capability. Micro is the simpler entry point for basic-shape, lower-volume use.",
          "If you are stuck, write down your first ten target customers. The list usually tells you which model you are really building.",
        ],
      },
    ],
    citations: [sbaStartup],
    relatedSlugs: [
      "how-to-start-cotton-candy-vending-business",
      "mini-micro-event-catering-business-guide",
      "best-locations-for-cotton-candy-vending-machines",
    ],
  },
  {
    slug: "business-setup-basics-llc-ein-insurance-permits",
    title: "Business Setup Basics: LLC, EIN, Bank Account, Insurance, and Permits",
    shortTitle: "Business Setup Basics",
    description:
      "A plain-English checklist for the admin side of starting a cotton candy machine business, with official SBA and IRS links.",
    category: "setup",
    audience: "New business owners",
    machineFit: "All machine paths",
    updatedAt: "2026-04-28",
    readingTime: "8 min read",
    heroImage: aboutHeroImage,
    heroImageAlt: "Bloomjoy operations team context for business setup planning",
    seoImagePath: "/seo/about.jpg",
    visualLabel: "Admin checklist",
    keyTakeaways: [
      "Business setup rules vary by state, city, entity type, and venue model.",
      "Form the entity first if you are creating an LLC, partnership, or corporation, then apply for an EIN.",
      "Use official SBA and IRS resources, then confirm local requirements with a qualified professional.",
    ],
    visualSummary: {
      title: "The admin stack has a sequence",
      items: [
        {
          label: "1",
          value: "Structure",
          description: "Choose the business structure and register where required.",
        },
        {
          label: "2",
          value: "EIN",
          description: "Apply directly through the IRS when your entity is ready.",
        },
        {
          label: "3",
          value: "Operate",
          description: "Banking, insurance, permits, and local compliance come next.",
        },
      ],
    },
    primaryCta: {
      label: "Request a quote when ready",
      href: "/contact?type=quote&source=%2Fresources%2Fbusiness-playbook%2Fbusiness-setup-basics-llc-ein-insurance-permits",
    },
    secondaryCta: {
      label: "Read the startup budget checklist",
      href: "/resources/business-playbook/startup-budget-checklist-cotton-candy-machine-business",
    },
    sections: [
      {
        heading: "This is not legal or tax advice",
        body: [
          "Bloomjoy can share an operator-minded checklist, but your legal, tax, insurance, and permit requirements depend on where and how you operate. Use this article to get organized, then confirm the details with your state, city, venue, accountant, insurance broker, or attorney.",
          "That said, a little admin planning goes a long way. It is much easier to open a bank account, sign a venue agreement, and collect payments when your paperwork is not a mystery.",
        ],
        callout: {
          title: "Important sequence",
          body: "The IRS says that if you are forming a legal entity such as an LLC, partnership, or corporation, you should form the entity with your state before applying for an EIN.",
        },
      },
      {
        heading: "Work through the basics in order",
        body: [
          "The SBA frames business startup as a sequence: research the market, write a plan, fund the business, pick a location, choose a structure, register, get tax IDs, apply for licenses and permits, and open a business bank account.",
          "For a cotton candy machine business, the practical version is simple: know what you are selling, where you are selling it, who owns the business, how money flows, and what local rules apply.",
        ],
        steps: [
          {
            title: "Choose a structure",
            body: "Common options include sole proprietorship, partnership, LLC, and corporation. Liability, taxes, and filing requirements vary.",
          },
          {
            title: "Register the business",
            body: "State and local rules vary. Confirm name, entity, and doing-business-as requirements.",
          },
          {
            title: "Apply for an EIN when appropriate",
            body: "The IRS offers free EIN applications directly through its official site.",
          },
          {
            title: "Open business banking",
            body: "Keep business money separate and make venue, tax, and supplier workflows cleaner.",
          },
          {
            title: "Research insurance and permits",
            body: "Food service, vending, sales tax, event, and local business requirements can vary by location and venue.",
          },
        ],
      },
      {
        heading: "Questions to ask before your first placement",
        body: [
          "The right questions save time. Ask them before you sign a venue agreement or book a paid event.",
          "If a venue already hosts food vendors, concessions, or entertainment machines, ask who manages approval and what documentation they require.",
        ],
        checklist: [
          "Do I need a local business license?",
          "Do I need food vending, event, or temporary seller permits?",
          "Do I need sales tax registration?",
          "What insurance does the venue require?",
          "Who is responsible for power, placement, cleaning access, and after-hours access?",
          "Can I provide invoices, W-9, certificate of insurance, or other requested documents?",
        ],
      },
    ],
    citations: [sbaStartup, sbaStructure, irsEin],
    relatedSlugs: [
      "startup-budget-checklist-cotton-candy-machine-business",
      "how-to-start-cotton-candy-vending-business",
      "commercial-vending-vs-event-catering",
    ],
  },
];

export const getPlaybookCategory = (id: PlaybookCategoryId) =>
  playbookCategories.find((category) => category.id === id);

export const getBusinessPlaybookArticle = (slug: string | undefined) =>
  businessPlaybookArticles.find((article) => article.slug === slug);

export const getRelatedBusinessPlaybookArticles = (article: BusinessPlaybookArticle) =>
  article.relatedSlugs
    .map((slug) => getBusinessPlaybookArticle(slug))
    .filter((related): related is BusinessPlaybookArticle => Boolean(related));

export const featuredBusinessPlaybookArticles = businessPlaybookArticles.slice(0, 3);

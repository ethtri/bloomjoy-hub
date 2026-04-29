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

const sbaLicensesPermits: PlaybookCitation = {
  label: "Apply for licenses and permits",
  source: "U.S. Small Business Administration",
  url: "https://www.sba.gov/business-guide/launch-your-business/apply-licenses-and-permits",
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
    updatedAt: "2026-04-29",
    readingTime: "13 min read",
    heroImage: commercialMachineImage,
    heroImageAlt: "Bloomjoy Commercial Machine ready for a venue placement",
    seoImagePath: "/seo/commercial-machine.jpg",
    visualLabel: "Launch roadmap",
    keyTakeaways: [
      "Start with the business model, not the machine alone.",
      "The best early plan has one target venue type, one launch budget, and one service rhythm.",
      "The first 30 days should feel like a small operating plan, not a scramble after delivery.",
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
        heading: "Before you buy, picture the first Tuesday",
        body: [
          "The most useful way to plan a vending business is to imagine an ordinary operating day, not the launch announcement. The machine is already placed. The first rush has passed. Someone needs to check supplies, wipe the area, confirm payments, answer the venue manager, and decide whether the machine is earning the right spot.",
          "That is where good operators separate themselves. They do not only ask, 'Can this machine make cotton candy?' They ask, 'Who owns the refill routine, what happens when a venue calls, where do supplies live, and how will I know this location is working?'",
          "Bloomjoy sells equipment, but we also operate machines. That changes how we think about the purchase. A machine is exciting. A repeatable operating rhythm is what gives it a real chance to become a business.",
        ],
        callout: {
          title: "What we would tell a first-time operator",
          body: "Do not start with ten possible ideas. Start with one target customer, one venue type, one machine fit, and one weekly routine you can actually keep.",
        },
      },
      {
        heading: "Start with the business model",
        body: [
          "A cotton candy machine can be a vending placement, an event attraction, a catering add-on, or a test of a larger venue strategy. The machine is the fun part. The business is the repeatable system around it.",
          "For most new operators, the simplest first question is: do you want a machine that earns from a fixed location, or do you want a portable offer that you bring to events? Those are both good businesses, but they ask different things from you.",
          "A fixed-location operator spends more time on site selection, owner relationships, uptime, restock, and reporting. An event operator spends more time on booking, transport, setup, line flow, staffing, and cleanup. If you pick the wrong model, the machine can still be good, but the work around it will feel wrong.",
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
          "The right v1 plan is not fancy. It is a short operating routine you can actually follow. A buyer who knows the first venue, the first supply order, the service owner, and the support path is in a much better position than a buyer who only knows the machine model.",
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
          {
            title: "Delivery week: slow down on purpose",
            body: "Confirm access, placement, power, supplies, and who is present before the machine shows up. A rushed delivery creates avoidable stress.",
          },
          {
            title: "First week live: inspect more often than you think",
            body: "Check customer flow, cleanliness, supply use, and venue feedback closely. The first week teaches you what the spreadsheet missed.",
          },
        ],
      },
      {
        heading: "Write the weekly operator rhythm",
        body: [
          "A small vending business becomes easier when the week has a pattern. You do not need a corporate operations manual, but you do need a rhythm that tells you what happens every week, who does it, and what proof you look at.",
          "For a single machine, that rhythm may be simple. For multiple machines, it becomes the difference between feeling organized and feeling like every text is an emergency.",
        ],
        table: {
          caption: "A starter rhythm you can adapt before launch.",
          columns: ["Operator moment", "What to check", "Why it matters"],
          rows: [
            [
              "Start of week",
              "Supply levels, upcoming venue hours, service schedule",
              "Prevents avoidable stockouts and missed access windows",
            ],
            [
              "Service visit",
              "Cleanliness, sugar/stick levels, payment flow, visible placement",
              "Keeps the machine guest-ready and venue-friendly",
            ],
            [
              "Venue check-in",
              "Staff feedback, guest questions, placement concerns, upcoming events",
              "Turns the venue into a partner instead of a landlord",
            ],
            [
              "End of week",
              "Sales trend, issues, supply use, next restock order",
              "Helps you decide whether to adjust placement, pitch, or routine",
            ],
          ],
        },
      },
      {
        heading: "Avoid the first-launch mistakes we see most often",
        body: [
          "New operators usually do not fail because they forgot to be excited. They struggle because they skipped the boring pieces that make the exciting part repeatable.",
          "Use this as a pre-launch honesty check. If any item makes you pause, that is not a bad sign. It is exactly the kind of gap you want to find before money, freight, and venue expectations are involved.",
        ],
        checklist: [
          "Buying before choosing the first business model",
          "Assuming the busiest location is automatically the best location",
          "Planning supplies only for opening day instead of the first operating cycle",
          "Leaving venue communication vague until there is a problem",
          "Forgetting that delivery, access, power, and cleaning are part of the business",
          "Treating legal, tax, insurance, and permit research as something to solve later",
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
    citations: [sbaStartup, sbaStructure, sbaLicensesPermits, irsEin, googleHelpfulContent],
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
    updatedAt: "2026-04-29",
    readingTime: "12 min read",
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
          "When we think about locations, we look for the pause. Where do families slow down? Where does a kid have time to point? Where is a parent already in treat mode? The best spot is often not the entrance. It might be near party check-in, an arcade prize counter, a concession line, or a lobby where families wait between activities.",
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
        heading: "Turn the scorecard into a decision",
        body: [
          "A scorecard only helps if you decide what the score means before you fall in love with a location. Use the total to decide the next move, not to create a false sense of certainty.",
          "If a location scores high but has one serious operational problem, treat it as a maybe until that problem is solved. A beautiful spot with bad access, unsafe power, or unclear ownership can become expensive quickly.",
        ],
        table: {
          caption: "A simple way to interpret a 25-point location score.",
          columns: ["Score", "Read", "Next move"],
          rows: [
            [
              "21-25",
              "Strong candidate",
              "Request a site walk, confirm power/access, and discuss pilot or terms",
            ],
            [
              "16-20",
              "Promising but needs proof",
              "Identify the weak score and ask targeted questions before pitching hard",
            ],
            [
              "11-15",
              "Probably not first",
              "Keep in the pipeline only if one fix would materially improve the site",
            ],
            [
              "10 or below",
              "Pass for now",
              "Do not spend early launch energy trying to rescue the wrong location",
            ],
          ],
        },
      },
      {
        heading: "Compare real-feeling venue scenarios",
        body: [
          "The point is not to find a perfect venue. The point is to understand why one venue deserves your attention before another.",
          "Here is how we would think about a few common situations before spending time on a pitch.",
        ],
        table: {
          columns: ["Scenario", "What looks good", "What to verify before yes"],
          rows: [
            [
              "Family entertainment center lobby",
              "Birthday traffic, parents waiting, kids already asking for treats",
              "Party schedule, staff contact, power, after-hours access, and cleaning expectations",
            ],
            [
              "Mall corridor near a food court",
              "Impulse traffic and visibility from multiple directions",
              "Lease rules, utility access, security hours, rent structure, and whether people actually pause",
            ],
            [
              "Tourist retail shop",
              "Vacation mindset, novelty products, gift/treat behavior",
              "Available footprint, staff burden, owner enthusiasm, and seasonal traffic swings",
            ],
            [
              "Busy commuter hallway",
              "Large raw traffic number",
              "Whether anyone is willing to stop. Often this is weaker than it looks.",
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
      {
        heading: "Build a location pipeline, not a wish list",
        body: [
          "One promising conversation is not a pipeline. A pipeline means you know which venues you want, where each conversation stands, and what the next useful action is.",
          "This keeps you from sounding generic. A venue owner can tell when you copied the same pitch to everyone. A good pipeline forces you to write down why each location might work.",
        ],
        steps: [
          {
            title: "Make a target list by category",
            body: "Group venues by FEC, mall, tourist retail, cinema, resort, school/event venue, or seasonal attraction.",
          },
          {
            title: "Research the specific pause point",
            body: "Write down where families wait, browse, celebrate, or line up before you send the first message.",
          },
          {
            title: "Start outreach with the venue benefit",
            body: "Lead with guest experience, not with a machine brochure.",
          },
          {
            title: "Use the site walk to qualify the deal",
            body: "Confirm visibility, power, service access, staff expectations, and commercial terms.",
          },
          {
            title: "Track the first 30 days",
            body: "If the venue says yes, define what you will review after launch: sales, service issues, staff feedback, and guest response.",
          },
        ],
      },
      {
        heading: "Watch for red flags early",
        body: [
          "A no is not a failure. Sometimes it is a gift. The wrong location can take more energy than it returns, especially when you are still learning the business.",
          "If you see several of these signs, slow down and either solve them in writing or move on.",
        ],
        checklist: [
          "The venue wants the machine hidden away from customer flow",
          "No one can clearly approve power, placement, and service access",
          "The owner only talks about rent and not guest experience",
          "Staff are expected to manage issues but have not agreed to that responsibility",
          "Access hours make restock or cleaning unrealistic",
          "Commercial terms are vague or change conversation to conversation",
        ],
      },
    ],
    citations: [sbaStartup, sbaLicensesPermits],
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
    updatedAt: "2026-04-29",
    readingTime: "12 min read",
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
          "Picture the morning of a birthday party or school fundraiser. You are loading supplies, confirming the address, checking power, packing backup tools, and thinking through where the line will form. The guests will remember the cotton candy. The buyer will remember whether you were calm, clean, and easy to work with.",
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
        heading: "Use sample packages before inventing custom quotes",
        body: [
          "Custom work is fine later. Early on, packages make the business easier to sell and easier to operate. They also keep you from accidentally promising three different businesses to three different customers.",
          "These are planning examples, not fixed prices. Replace the serving counts, travel radius, staffing, and policy details with what fits your machine, market, and comfort level.",
        ],
        table: {
          caption: "Starter package structure for event operators.",
          columns: ["Package", "Best for", "What to define"],
          rows: [
            [
              "Birthday pop-up",
              "Backyard parties, play spaces, smaller private events",
              "Service window, estimated servings, color/menu choices, travel radius, setup space",
            ],
            [
              "School or corporate event",
              "Longer guest flow, invoice-friendly buyers, planned schedule",
              "COI needs, arrival time, staff contact, power, payment/invoicing process",
            ],
            [
              "Festival or fair booth",
              "Public traffic, longer day, more unknowns",
              "Booth layout, weather plan, restock plan, line control, staffing shifts",
            ],
          ],
        },
      },
      {
        heading: "Plan serving counts like an operator",
        body: [
          "Serving estimates are not promises. They are planning tools that help you avoid under-packing, under-staffing, or setting up in a way that makes the line harder than it needs to be.",
          "Start with the buyer's expected attendance, then discount for who will actually want cotton candy, the event length, competing food, and whether people arrive all at once or slowly over time.",
        ],
        table: {
          caption: "A simple serving-planning worksheet.",
          columns: ["Planning input", "Question to answer", "Operator note"],
          rows: [
            [
              "Guest count",
              "How many people are expected, and how many are kids or treat buyers?",
              "Do not pack only for the invitation count. Pack for realistic demand plus buffer.",
            ],
            [
              "Service window",
              "Will demand hit all at once or spread across the event?",
              "A two-hour party and a six-hour fair need different queue plans.",
            ],
            [
              "Menu complexity",
              "How many colors, shapes, or choices are you offering?",
              "More options can slow the line, especially with children choosing.",
            ],
            [
              "Staffing",
              "Who greets, manages the line, handles payment, and resets supplies?",
              "If one person owns everything, keep the offer simpler.",
            ],
          ],
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
      {
        heading: "Run the event day from a checklist",
        body: [
          "The best event operators make the day feel boring in the best possible way. They know when to arrive, what gets unpacked first, how the line works, and what happens if the venue contact is busy.",
          "Write this down before your first paid booking. When the event is loud, hot, crowded, or running late, a checklist is kinder than memory.",
        ],
        steps: [
          {
            title: "Day before",
            body: "Confirm address, contact, arrival window, power, parking, load-in path, weather, and expected attendance.",
          },
          {
            title: "Arrival",
            body: "Find the venue contact, inspect power, choose the line direction, and keep walkways clear before unpacking fully.",
          },
          {
            title: "Setup",
            body: "Place table/signage, stage supplies, test the machine, prepare payment backup if needed, and take a clean setup photo.",
          },
          {
            title: "Service",
            body: "Keep the menu simple, watch the line, restock before you are empty, and clean small messes before they look like messes.",
          },
          {
            title: "Teardown",
            body: "Pack cleanly, remove trash, thank the buyer, note supply use, and write one improvement for the next booking.",
          },
        ],
      },
      {
        heading: "Put policies in writing before money changes hands",
        body: [
          "Policies are not about being difficult. They protect the customer, the operator, and the event. A friendly business can still be clear.",
          "At minimum, your booking flow should explain what is included, what the customer provides, when payment is due, and what happens if conditions change.",
        ],
        checklist: [
          "Deposit and final payment timing",
          "Travel radius and extra travel fees",
          "Indoor/outdoor and weather policy",
          "Power, table, tent, or space requirements",
          "Cancellation or reschedule policy",
          "Certificate of insurance or vendor paperwork timing",
        ],
      },
    ],
    citations: [sbaStartup, sbaLicensesPermits],
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
    updatedAt: "2026-04-29",
    readingTime: "12 min read",
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
          "Think about the first 90 days, not just purchase day. You may need opening supplies, a second supply order, travel, storage, signage, payment setup, venue paperwork, insurance documentation, and a reserve for normal early surprises.",
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
        heading: "Build a worksheet with formulas, not guesses",
        body: [
          "A good budget lets you replace assumptions with real quotes over time. Start with placeholders, then mark each line as estimated, quoted, paid, or recurring.",
          "Avoid using someone else's budget as a shortcut. Freight, local permits, insurance, venue terms, and event setup needs can change the picture quickly.",
        ],
        table: {
          caption: "Public-safe worksheet structure. Replace blanks with your actual quotes.",
          columns: ["Line item", "Planning formula", "Status to track"],
          rows: [
            [
              "Core equipment",
              "Machine quote + selected configuration + payment hardware if applicable",
              "Quoted before deposit",
            ],
            [
              "Freight and delivery",
              "Freight quote + access requirements + liftgate/install assumptions",
              "Quoted after delivery location is known",
            ],
            [
              "Opening supplies",
              "Expected first operating cycle x supply buffer",
              "Ordered before launch",
            ],
            [
              "Venue or event setup",
              "Signage + table/display needs + extension/power plan + storage/transport",
              "Estimated, then confirmed by site walk",
            ],
            [
              "Admin and compliance",
              "Registration + insurance + permits + professional advice as needed",
              "Confirmed locally",
            ],
            [
              "Operating reserve",
              "One to three months of known fixed obligations, adjusted for risk",
              "Set aside before launch when possible",
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
        heading: "Stress-test the first few months",
        body: [
          "Planning is not the same as promising profit. The point of a stress test is to understand what has to be true for the business to feel healthy.",
          "Use conservative assumptions first. If the plan only works when every location is perfect, every weekend is busy, and nothing breaks your schedule, it is probably too fragile.",
        ],
        table: {
          caption: "Simple questions to pressure-test your plan.",
          columns: ["Question", "Formula or check", "What it tells you"],
          rows: [
            [
              "What are my fixed monthly obligations?",
              "Rent, subscriptions, insurance, storage, financing, or other fixed costs",
              "The baseline the business must cover before it feels comfortable",
            ],
            [
              "How many orders cover fixed obligations?",
              "Fixed obligations divided by expected contribution per order",
              "A rough break-even order count, not a profit promise",
            ],
            [
              "What if demand is 25% lower than expected?",
              "Reduce expected orders and rerun the worksheet",
              "Whether the launch still has breathing room",
            ],
            [
              "What if restock or service costs are higher?",
              "Increase supplies, travel, or labor assumptions",
              "Whether your reserve is large enough for normal variance",
            ],
          ],
        },
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
      {
        heading: "Bring better questions into the quote conversation",
        body: [
          "A good quote conversation is not just, 'What does the machine cost?' It is a fit conversation. The more context you bring, the better the answer can be.",
          "Before you talk to Bloomjoy or any equipment provider, write down the business model, target venues, launch timing, budget constraints, and what you need the machine to do on day one.",
        ],
        checklist: [
          "Which model am I building first: fixed vending, events, or hybrid?",
          "Do I have a target venue type or event buyer already in mind?",
          "Do I need complex patterns, higher throughput, portability, or a lower-cost test?",
          "Where will the machine live, and what delivery/access constraints exist?",
          "Which costs are fixed, quoted, estimated, or still unknown?",
          "What reserve can I set aside after buying the machine and opening supplies?",
        ],
        callout: {
          title: "What this means in practice",
          body: "The cheapest plan is not always the safest plan. The right plan gives the machine enough support, supplies, and breathing room to operate well after the excitement of launch day.",
        },
      },
    ],
    citations: [sbaStartup, sbaStructure, sbaLicensesPermits],
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
    updatedAt: "2026-04-29",
    readingTime: "12 min read",
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
          "The best pitch sounds like you have already thought through their day. Where does the machine sit? Who services it? What happens if a guest has a question? How do they make money or improve the guest experience without adding staff chaos?",
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
        heading: "Use the right script for the moment",
        body: [
          "A cold email, warm intro, follow-up, and site-walk recap should not sound identical. Keep the same core promise, but match the message to the relationship.",
          "The goal is not to win the whole deal in one note. The goal is to earn a short conversation or walkthrough.",
        ],
        script: {
          title: "Three useful outreach scripts",
          lines: [
            "Cold email: Hi [Name], I operate robotic cotton candy machines for family-friendly venues. I noticed [specific reason the venue has family dwell time], and I think there may be a guest-experience fit worth exploring.",
            "Warm intro: [Referrer] mentioned you manage guest experience at [Venue]. I help place and service robotic cotton candy machines, and I would love to see whether a small pilot could add a fun treat moment without adding staff work.",
            "Site-walk follow-up: Thanks for walking the space today. Based on what we saw, the strongest potential placement is [area] because [reason]. The open questions are [power/access/terms]. If those check out, I suggest a short pilot with clear success metrics.",
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
        heading: "Prepare for owner objections",
        body: [
          "Objections are not bad. They usually mean the owner is picturing the machine in their space. Treat each concern as a chance to show that you are an operator, not just a salesperson.",
          "If you do not know the answer yet, say so and follow up. Guessing creates more risk than pausing.",
        ],
        table: {
          columns: ["Owner concern", "Helpful answer angle", "Proof to bring"],
          rows: [
            [
              "Will this make a mess?",
              "Explain cleaning routine, service schedule, and who owns cleanup",
              "Checklist, supply plan, and service contact",
            ],
            [
              "Will staff have to manage it?",
              "Clarify what staff do and do not own",
              "Simple issue path and operator contact",
            ],
            [
              "Will it take too much space?",
              "Show footprint, flow, and placement options",
              "Photos, measurements, and site-walk notes",
            ],
            [
              "What about insurance or paperwork?",
              "Ask what documents the venue requires and confirm timing",
              "Business setup packet or document checklist",
            ],
            [
              "How do we know guests will use it?",
              "Offer a pilot with simple success metrics",
              "Location scorecard and proposed review date",
            ],
          ],
        },
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
      {
        heading: "Run the site walk like a professional",
        body: [
          "A site walk is not a tour. It is a qualification meeting. You are checking whether the venue, machine, owner, and operating routine can all work together.",
          "Bring a short agenda so the owner feels you are making the decision easier, not creating another project for them.",
        ],
        checklist: [
          "Confirm the decision maker and day-to-day staff contact",
          "Stand in the proposed placement and watch guest flow",
          "Verify power, cleaning access, restock access, and security hours",
          "Discuss commercial terms: rent, revenue share, pilot length, or amenity logic",
          "Agree on what staff should do if there is a question or issue",
          "Set a follow-up date and define the next decision",
        ],
      },
      {
        heading: "Report back after launch",
        body: [
          "Winning the location is only the first part. Keeping it means proving that you are paying attention.",
          "A simple owner update can be enough: what happened, what you checked, what you are adjusting, and what you need from the venue. This is especially helpful after the first week and first month.",
        ],
        table: {
          caption: "Simple owner update structure.",
          columns: ["Update line", "Example"],
          rows: [
            [
              "Guest response",
              "Families are stopping most often before/after birthday check-in.",
            ],
            [
              "Operations",
              "Service visit completed Monday; supplies are stocked and area was cleaned.",
            ],
            [
              "Adjustment",
              "We recommend turning the machine slightly toward the waiting area for better visibility.",
            ],
            [
              "Ask",
              "Please tell staff to text [contact] if they notice a supply or guest question.",
            ],
          ],
        },
      },
    ],
    citations: [sbaStartup, sbaLicensesPermits],
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
    updatedAt: "2026-04-29",
    readingTime: "11 min read",
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
          "This is why the question is not simply, 'Which machine is best?' The better question is, 'Which operating life am I willing to build?' A machine can support the business, but it cannot make you love the work around it.",
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
        heading: "Compare a normal week in each model",
        body: [
          "The daily work is where the decision becomes clear. Imagine doing the business on an average week, not just on the day you announce it.",
          "If one column sounds energizing and the other sounds draining, pay attention. That is useful data.",
        ],
        table: {
          columns: ["Work moment", "Commercial vending", "Event or catering"],
          rows: [
            [
              "Selling",
              "Research venues, pitch owners, schedule site walks, negotiate terms",
              "Answer inquiries, quote packages, follow up with planners and parents",
            ],
            [
              "Operations",
              "Service route, restock, clean, check payments, update owner",
              "Pack, transport, set up, serve, manage line, tear down",
            ],
            [
              "Schedule shape",
              "More repeatable once locations are active",
              "More weekend and event-date driven",
            ],
            [
              "Main risk",
              "Weak placement or unclear service responsibility",
              "Underpriced events, poor logistics, or too much custom work",
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
        heading: "Choose this path if",
        body: [
          "Neither path is automatically better. The right choice depends on your goals, schedule, sales comfort, budget, and appetite for operational complexity.",
          "Use these prompts as a decision tree before you compare machine specs.",
        ],
        table: {
          columns: ["Choose", "If this sounds like you", "Be honest about"],
          rows: [
            [
              "Commercial vending",
              "You like B2B selling, repeat locations, and building a small route over time",
              "Venue outreach can be slow, and a bad location can waste months",
            ],
            [
              "Events and catering",
              "You like live customer energy, weekend work, and booking-based revenue",
              "Every event has logistics, policies, and customer communication",
            ],
            [
              "Mini/Micro testing",
              "You want a smaller first step before committing to a larger placement strategy",
              "Lower complexity can also mean lower throughput or simpler output",
            ],
            [
              "Hybrid later",
              "You already have one path stable and want to add another channel",
              "Hybrid too early can split attention before either model is strong",
            ],
          ],
        },
      },
      {
        heading: "Let the business model choose the machine",
        body: [
          "A Commercial Machine is designed for high-throughput, fixed or serious venue use. Mini is designed for operators who need a more portable footprint and still want stronger pattern capability. Micro is the simpler entry point for basic-shape, lower-volume use.",
          "If you are stuck, write down your first ten target customers. The list usually tells you which model you are really building.",
        ],
        callout: {
          title: "The first ten customer test",
          body: "If your list is mostly venue owners, mall managers, FEC operators, and attraction managers, you are probably building a vending placement business. If it is parents, schools, event planners, companies, and festival organizers, you are probably building an event business. If the list is half and half, pick the side you can sell and operate first.",
        },
      },
      {
        heading: "Know when not to choose a path",
        body: [
          "Good operators say no to the wrong first move. That does not mean the idea is bad forever. It means the timing, resources, or operating model may not be ready yet.",
          "A clear no can protect your budget and your energy.",
        ],
        checklist: [
          "Do not choose vending first if you have no realistic venue pipeline and do not want to pitch owners.",
          "Do not choose events first if weekend work, transport, setup, and customer communication sound exhausting.",
          "Do not choose hybrid first if you have not proven either location service or event execution.",
          "Do not choose solely by machine price if the cheaper path cannot do the work your business model needs.",
          "Do not ignore admin basics because the machine itself feels fun and tangible.",
        ],
      },
    ],
    citations: [sbaStartup, sbaLicensesPermits],
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
    updatedAt: "2026-04-29",
    readingTime: "12 min read",
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
          "Think of this as an admin day. Put the boring documents in one folder before the venue asks for them. It is not the most photogenic part of a cotton candy business, but it can make you look serious when a good location is ready to move.",
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
        heading: "Create a venue-ready document packet",
        body: [
          "Venues vary, but many professional conversations eventually become a paperwork conversation. If you can answer calmly, you feel less like a hobbyist and more like a partner.",
          "Do not fabricate or rush documents. Build the packet as each item becomes real and verified for your business.",
        ],
        checklist: [
          "Business formation or registration confirmation, if applicable",
          "EIN confirmation letter or tax ID documentation, if applicable",
          "W-9 for U.S. venue or vendor onboarding workflows",
          "Certificate of insurance, if the venue requires one",
          "Local business license, seller's permit, food/vendor permit, or event permit where required",
          "Simple venue agreement or pilot agreement",
          "Machine/service contact sheet for day-to-day questions",
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
      {
        heading: "Track renewals before they become urgent",
        body: [
          "Some licenses and permits expire. Insurance renews. Venue paperwork may need updates. A small renewal calendar can save you from a last-minute scramble.",
          "The SBA notes that license and permit requirements and fees can vary by business activity, location, and government rules, and that vending machines are commonly regulated at the local level. That is your cue to check locally and keep dates organized.",
        ],
        table: {
          caption: "Simple compliance calendar fields.",
          columns: ["Item", "Who to confirm with", "Date to track"],
          rows: [
            [
              "Business registration",
              "State or local registration office",
              "Annual report, renewal, or filing deadline",
            ],
            [
              "Sales tax or seller permit",
              "State tax agency or local authority",
              "Filing dates and renewal date if applicable",
            ],
            [
              "Food, vending, or event permit",
              "City, county, health department, or event organizer",
              "Expiration date and event-specific deadlines",
            ],
            [
              "Insurance",
              "Insurance broker or carrier",
              "Policy renewal and certificate request timing",
            ],
            [
              "Venue agreement",
              "Venue owner or property manager",
              "Pilot review, renewal, or termination dates",
            ],
          ],
        },
      },
      {
        heading: "Ask better questions of professionals",
        body: [
          "A professional advisor can help more when you bring a specific business model. Saying 'I might sell cotton candy somehow' is hard to advise. Saying 'I plan to place a machine in family entertainment venues in this county' is much better.",
          "Bring your planned locations, sales model, ownership structure, and first launch timeline into the conversation.",
        ],
        bullets: [
          "Ask an accountant how to handle sales tax, income tracking, expenses, and entity choice for your situation.",
          "Ask an insurance broker what coverage venues commonly require for vending or event work.",
          "Ask the city, county, health department, or event organizer which permits apply to your planned activity.",
          "Ask venues what vendor documents they need before you sign or launch.",
        ],
      },
    ],
    citations: [sbaStartup, sbaStructure, sbaLicensesPermits, irsEin],
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

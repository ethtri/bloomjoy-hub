import type { AppSurface } from "@/lib/appSurface";
import { businessPlaybookArticles } from "@/data/businessPlaybook";
import { paybackPlannerPath } from "@/data/businessPlaybookPaybackPlanner";

export type RouteSeo = {
  path: string;
  title: string;
  description: string;
  robots: string;
  surface: AppSurface;
  ogType?: "website" | "article";
  canonicalPath?: string;
  ogImagePath?: string;
  ogImageAlt?: string;
  sitemapImages?: Array<{
    loc: string;
    title: string;
  }>;
  lastmod: string;
  structuredDataKind?:
    | "machine-product"
    | "supplies"
    | "faq"
    | "business-playbook-index"
    | "business-playbook-article";
};

export type PrivateRouteSeo = RouteSeo & {
  title: string;
  canonicalOrigin: string;
};

export const MARKETING_ORIGIN = "https://www.bloomjoyusa.com";
export const APP_ORIGIN = "https://app.bloomjoyusa.com";
export const WEBSITE_NAME = "Bloomjoy Hub";
export const ORGANIZATION_NAME = "Bloomjoy";
export const ORGANIZATION_LOGO_PATH = "/bloomjoy-icon.png";
export const DEFAULT_SHARE_IMAGE_PATH = "/seo/home-machine.jpg";
export const STRUCTURED_DATA_SCRIPT_ID = "seo-structured-data";
export const THEME_COLOR = "#f672a2";
export const DEFAULT_IMAGE_ALT = "Bloomjoy robotic cotton candy machine and operator supplies";
export const DEFAULT_DESCRIPTION =
  "Bloomjoy Hub for robotic cotton candy machines, supplies, training, and support.";
export const PUBLIC_ROBOTS =
  "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1";
export const PRIVATE_ROBOTS = "noindex,nofollow,noarchive,nosnippet";

const LASTMOD = "2026-05-11";

export const commercialMachineFaqs = [
  {
    q: "What makes the Commercial Machine the best fit for high-traffic venues?",
    a: "It is the full-size Bloomjoy robotic cotton candy machine with automatic stick dispensing, 64 preset patterns, four sugar colors, and a 200-250 candy output per full material load.",
  },
  {
    q: "How long does each cotton candy take?",
    a: "The commercial machine produces each candy in roughly 70-130 seconds, depending on pattern and operating conditions.",
  },
  {
    q: "What maintenance rhythm should operators plan for?",
    a: "Typical routine maintenance is about every 15 days and can usually be completed in roughly 20-30 minutes.",
  },
  {
    q: "Can the Commercial Machine use a custom wrap?",
    a: "Yes. Custom wrap is available only for the Commercial Machine, and final artwork is coordinated offline with the Bloomjoy design team.",
  },
];

export const miniMachineFaqs = [
  {
    q: "How many servings can the Mini Machine make per hour?",
    a: "Owner-provided guidance is roughly one candy every 90 seconds, or about 40 candies per hour of machine-cycle capacity. For planning, use about 25-35 served candies per hour with a trained staff member, or about 12-25 per hour in quieter spa, salon, or hospitality service where guest interaction intentionally slows the flow. These are estimates, not guaranteed throughput.",
  },
  {
    q: "What are the Mini Machine dimensions and power requirements?",
    a: "Mini specs are 430 x 555 x 1582 mm, 83.9 kg, AC 110V/220V rated voltage, 2400W maximum power, and 100W standby power. Final placement and power details should be confirmed during quote review.",
  },
  {
    q: "Can the Mini Machine work in a spa, salon, or hospitality environment?",
    a: "Mini can be evaluated as a staffed guest-experience amenity for smaller hospitality spaces, but it still needs approved power, stable placement, service access, a cleaning path, and review of operating sound, motion, and cotton-candy aroma. As an unmeasured planning estimate, treat operating sound as roughly conversation-level, about 55-65 dBA close range, until tested in the actual room.",
  },
  {
    q: "How much staff training and maintenance should Mini operators plan for?",
    a: "Mini is a staffed machine because each stick is manually fed. Plan about 30-60 minutes for a basic staff ramp plus practice servings, then use Bloomjoy Plus for task-based training, setup guides, cleaning checklists, troubleshooting references, and the Operator Essentials certificate path. Plan a 5-10 minute daily wipe-down and debris check, plus routine maintenance about every 15 days and roughly 20-30 minutes, then confirm Mini-specific details during onboarding.",
  },
  {
    q: "What cost per serving and selling price should I model?",
    a: "As planning assumptions, model roughly $0.35-$0.50 in consumables per serving before payment fees, labor, venue costs, and machine cost. That estimate includes sugar, a paper stick, and a small buffer for waste or light packaging. For price testing, use a scenario range such as $7-$10 per serving, not as market advice or a promise of sales, ROI, or payback.",
  },
  {
    q: "What warranty and support apply to the Mini Machine?",
    a: "Mini follows the same public warranty posture as the Commercial Machine: up to 1.5-year machine warranty, manufacturer 24/7 first-line remote technical support via WeChat, and a replacement-part workflow. For planning, treat manufacturer remote response as typically within 12-24 hours when the support channel is active. Bloomjoy adds onboarding, concierge guidance, and translation/escalation support during US business hours.",
  },
  {
    q: "What maintenance issues should operators expect?",
    a: "The most common operator checks are dry sugar feed, sugar fill level and cap seal, paper-stick position, output path debris, sugar pickup or sensor areas, and burner/spinner residue. Replacement-part availability and cost are confirmed case by case after remote diagnosis.",
  },
];

export const machineBuyerFaqs = [
  {
    q: "Which Bloomjoy machine should I compare first?",
    a: "Start with the Commercial Machine for high-throughput venues, Mini for a smaller portable footprint, and Micro for basic-shape, low-volume applications.",
  },
  {
    q: "Are Bloomjoy machines sold through checkout or quote?",
    a: "Machine purchases are quote-led so Bloomjoy can confirm configuration, shipping, operator handoff, and support expectations before invoicing.",
  },
  {
    q: "Do all machines support complex cotton candy patterns?",
    a: "No. The Commercial Machine supports the full 64-pattern library, Mini supports most complex patterns, and Micro is limited to basic shapes.",
  },
  {
    q: "What supplies do I need after buying a machine?",
    a: "Bloomjoy machines run on cotton candy sugar and paper sticks. The supplies page supports bulk sugar orders, Bloomjoy branded sticks, and custom stick requests.",
  },
];

export const resourcesFaqs = [
  {
    q: "What startup costs should I expect to launch an operation?",
    a: "Plan for several setup categories rather than one fixed all-in number: the machine purchase, opening consumables like sugar and paper sticks, shipping or freight, optional Bloomjoy Plus membership, venue or site setup needs, payment and operations supplies, and permits, insurance, or other local requirements where applicable. Bloomjoy uses the quote/contact flow to confirm machine fit, delivery assumptions, opening supplies, and support options so you can get a personalized launch estimate before invoicing.",
    ctaLabel: "Request a personalized quote",
    ctaHref: "/contact?type=quote&source=%2Fresources%23faq",
  },
  {
    q: "What support is included with machine purchase?",
    a: "The manufacturer support team provides 24/7 first-line technical support via WeChat. Bloomjoy provides onboarding guidance and Plus concierge support during US business hours.",
  },
  {
    q: "How do I get replacement parts?",
    a: "Plus members can request parts assistance through the member portal. Bloomjoy helps source parts from the manufacturer and keeps the request tied to the support workflow.",
  },
  {
    q: "What is the difference between the Commercial, Mini, and Micro machines?",
    a: "Commercial is full-size with automatic stick dispensing and the deepest pattern set. Mini is portable with manual stick feeding, most complex pattern capability, and roughly 90-second cycle guidance. Micro is the entry-level machine for basic shapes only.",
  },
  {
    q: "Can Mini fit a spa, salon, or hospitality setting?",
    a: "Mini can be evaluated for staffed hospitality activations where a compact footprint matters. Confirm the 430 x 555 x 1582 mm cabinet, 2400W maximum power, cleaning path, operator staffing, guest flow, and sensitivity to operating sound and cotton-candy aroma during quote review. Until room testing is available, use roughly conversation-level sound as a planning assumption, not a measured guarantee.",
  },
  {
    q: "How should I think about Mini throughput and cost per serving?",
    a: "Use roughly one candy every 90 seconds as the machine-cycle planning input, then model about 25-35 served candies per hour for staffed service or about 12-25 per hour for slower hospitality-style service. As a worksheet input, use roughly $0.35-$0.50 consumables per serving before payment fees, labor, venue costs, and machine cost. Bloomjoy does not promise sales volume, ROI, or payback dates.",
  },
  {
    q: "Can Bloomjoy help my team learn daily operation?",
    a: "Yes. Bloomjoy Plus includes task-based training, operator guides, maintenance checklists, and the Operator Essentials completion certificate path.",
  },
  {
    q: "What should I know before requesting a machine quote?",
    a: "Bring your target venue type, planning-volume assumptions, delivery location, preferred machine model, and any wrap or supplies needs so Bloomjoy can confirm fit and next steps.",
  },
  {
    q: "Which sugar and stick supplies are available?",
    a: "Bloomjoy sells bulk cotton candy sugar in core colors, Bloomjoy branded paper sticks by box, and custom stick requests with artwork proofing.",
  },
];

const businessPlaybookSeoRoutes: RouteSeo[] = [
  {
    path: "/resources/business-playbook",
    title: "Bloomjoy Business Playbook | Cotton Candy Business Guides",
    description:
      "Read practical Bloomjoy guides for starting a cotton candy vending, event, or catering business with operator-led tips, visuals, budget planning, and location strategy.",
    robots: PUBLIC_ROBOTS,
    surface: "marketing",
    ogType: "website",
    ogImagePath: DEFAULT_SHARE_IMAGE_PATH,
    ogImageAlt: "Bloomjoy Business Playbook for cotton candy machine operators",
    lastmod: LASTMOD,
    structuredDataKind: "business-playbook-index",
  },
  {
    path: "/resources/business-playbook/planner",
    title: "Machine Fit and Startup Budget Planner | Bloomjoy Business Playbook",
    description:
      "Use Bloomjoy's interactive cotton candy machine fit and startup budget planner to compare Commercial, Mini, and Micro paths before a quote call.",
    robots: PUBLIC_ROBOTS,
    surface: "marketing",
    ogType: "website",
    ogImagePath: DEFAULT_SHARE_IMAGE_PATH,
    ogImageAlt: "Bloomjoy Business Playbook machine fit and startup budget planner",
    lastmod: LASTMOD,
  },
  {
    path: paybackPlannerPath,
    title: "Payback Scenario Planner | Bloomjoy Business Playbook",
    description:
      "Use Bloomjoy's public Payback Scenario Planner to pressure-test startup cost recovery assumptions for Commercial, Mini, and Micro cotton candy machine paths.",
    robots: PUBLIC_ROBOTS,
    surface: "marketing",
    ogType: "website",
    ogImagePath: DEFAULT_SHARE_IMAGE_PATH,
    ogImageAlt: "Bloomjoy Payback Scenario Planner for cotton candy machine operators",
    lastmod: LASTMOD,
  },
  ...businessPlaybookArticles.map(
    (article): RouteSeo => ({
      path: `/resources/business-playbook/${article.slug}`,
      title: `${article.title} | Bloomjoy Business Playbook`,
      description: article.description,
      robots: PUBLIC_ROBOTS,
      surface: "marketing",
      ogType: "article",
      ogImagePath: article.seoImagePath,
      ogImageAlt: article.heroImageAlt,
      sitemapImages: [
        {
          loc: `${MARKETING_ORIGIN}${article.seoImagePath}`,
          title: article.title,
        },
      ],
      lastmod: article.updatedAt,
      structuredDataKind: "business-playbook-article",
    })
  ),
];

export const publicRoutes: RouteSeo[] = [
  {
    path: "/",
    title: "Robotic Cotton Candy Machines and Supplies | Bloomjoy",
    description:
      "Explore Bloomjoy robotic cotton candy machines, bulk sugar, paper sticks, training, and operator support for commercial cotton candy buyers.",
    robots: PUBLIC_ROBOTS,
    surface: "marketing",
    ogType: "website",
    ogImagePath: "/seo/home-machine.jpg",
    ogImageAlt: DEFAULT_IMAGE_ALT,
    sitemapImages: [
      {
        loc: `${MARKETING_ORIGIN}/seo/home-machine.jpg`,
        title: "Bloomjoy robotic cotton candy machine",
      },
    ],
    lastmod: LASTMOD,
  },
  {
    path: "/machines",
    title: "Robotic Cotton Candy Machines for Operators | Bloomjoy",
    description:
      "Compare Bloomjoy commercial, Mini, and Micro robotic cotton candy machines by footprint, pattern capability, use case, support, and quote path.",
    robots: PUBLIC_ROBOTS,
    surface: "marketing",
    ogImagePath: "/seo/machines-lineup.jpg",
    ogImageAlt: "Bloomjoy robotic cotton candy machine lineup",
    sitemapImages: [
      {
        loc: `${MARKETING_ORIGIN}/seo/machines-lineup.jpg`,
        title: "Bloomjoy robotic cotton candy machines",
      },
    ],
    lastmod: LASTMOD,
    structuredDataKind: "faq",
  },
  {
    path: "/machines/commercial-robotic-machine",
    title: "Commercial Robotic Cotton Candy Machine | Bloomjoy",
    description:
      "Review the Bloomjoy Commercial Machine specs, 64-pattern library, 70-130 second candy cycle, footprint, supplies, maintenance rhythm, and quote flow.",
    robots: PUBLIC_ROBOTS,
    surface: "marketing",
    ogImagePath: "/seo/commercial-machine.jpg",
    ogImageAlt: "Bloomjoy Commercial Machine for robotic cotton candy operators",
    sitemapImages: [
      {
        loc: `${MARKETING_ORIGIN}/seo/commercial-machine.jpg`,
        title: "Bloomjoy Commercial Machine",
      },
    ],
    lastmod: LASTMOD,
    structuredDataKind: "machine-product",
  },
  {
    path: "/machines/mini",
    title: "Mini Robotic Cotton Candy Machine | Bloomjoy",
    description:
      "Explore Bloomjoy Mini Machine specs, proof clips, 90-second cycle guidance, spa and hospitality fit, support, and quote-led ordering.",
    robots: PUBLIC_ROBOTS,
    surface: "marketing",
    ogImagePath: "/seo/mini-machine.jpg",
    ogImageAlt: "Bloomjoy Mini Machine",
    sitemapImages: [
      {
        loc: `${MARKETING_ORIGIN}/seo/mini-machine.jpg`,
        title: "Bloomjoy Mini Machine",
      },
    ],
    lastmod: LASTMOD,
    structuredDataKind: "machine-product",
  },
  {
    path: "/machines/micro",
    title: "Micro Robotic Cotton Candy Machine | Bloomjoy",
    description:
      "Explore the Bloomjoy Micro Machine for compact, low-volume robotic cotton candy applications with basic shapes and quote-led ordering.",
    robots: PUBLIC_ROBOTS,
    surface: "marketing",
    ogImagePath: "/seo/micro-machine.jpg",
    ogImageAlt: "Bloomjoy Micro Machine",
    sitemapImages: [
      {
        loc: `${MARKETING_ORIGIN}/seo/micro-machine.jpg`,
        title: "Bloomjoy Micro Machine",
      },
    ],
    lastmod: LASTMOD,
    structuredDataKind: "machine-product",
  },
  {
    path: "/supplies",
    title: "Cotton Candy Machine Sugar and Paper Sticks | Bloomjoy",
    description:
      "Order Bloomjoy cotton candy machine sugar, Bloomjoy branded paper sticks, and custom sticks for commercial robotic cotton candy operations.",
    robots: PUBLIC_ROBOTS,
    surface: "marketing",
    ogImagePath: "/seo/supplies.jpg",
    ogImageAlt: "Bloomjoy cotton candy sugar and paper sticks",
    sitemapImages: [
      {
        loc: `${MARKETING_ORIGIN}/seo/supplies.jpg`,
        title: "Bloomjoy cotton candy machine sugar and paper sticks",
      },
    ],
    lastmod: LASTMOD,
    structuredDataKind: "supplies",
  },
  {
    path: "/plus",
    title: "Bloomjoy Plus Operator Training and Support | Bloomjoy",
    description:
      "View Bloomjoy Plus training, onboarding guides, support boundaries, operator certificate path, and flat monthly pricing.",
    robots: PUBLIC_ROBOTS,
    surface: "marketing",
    ogImagePath: DEFAULT_SHARE_IMAGE_PATH,
    ogImageAlt: "Bloomjoy Plus operator training and support",
    lastmod: LASTMOD,
  },
  {
    path: "/resources",
    title: "Business Playbook and Robotic Cotton Candy Machine Resources | Bloomjoy",
    description:
      "Explore the Bloomjoy Business Playbook, FAQs, operator resources, supplies guidance, support boundaries, and machine quote preparation.",
    robots: PUBLIC_ROBOTS,
    surface: "marketing",
    ogImagePath: DEFAULT_SHARE_IMAGE_PATH,
    ogImageAlt: "Bloomjoy machine buyer resources",
    lastmod: LASTMOD,
    structuredDataKind: "faq",
  },
  ...businessPlaybookSeoRoutes,
  {
    path: "/contact",
    title: "Request a Robotic Cotton Candy Machine Quote | Bloomjoy",
    description:
      "Contact Bloomjoy for robotic cotton candy machine quotes, demo questions, procurement needs, supplies, and operator support.",
    robots: PUBLIC_ROBOTS,
    surface: "marketing",
    ogImagePath: DEFAULT_SHARE_IMAGE_PATH,
    ogImageAlt: "Bloomjoy quote request",
    lastmod: LASTMOD,
  },
  {
    path: "/about",
    title: "About Bloomjoy | Robotic Cotton Candy Operators",
    description:
      "Meet Bloomjoy and our operator-focused approach to robotic cotton candy machines, supplies, training, and field support.",
    robots: PUBLIC_ROBOTS,
    surface: "marketing",
    ogImagePath: "/seo/about.jpg",
    ogImageAlt: "Bloomjoy operator experience",
    sitemapImages: [
      {
        loc: `${MARKETING_ORIGIN}/seo/about.jpg`,
        title: "Bloomjoy operator experience",
      },
    ],
    lastmod: LASTMOD,
  },
  {
    path: "/privacy",
    title: "Privacy Policy | Bloomjoy",
    description: DEFAULT_DESCRIPTION,
    robots: PUBLIC_ROBOTS,
    surface: "marketing",
    ogType: "article",
    ogImagePath: DEFAULT_SHARE_IMAGE_PATH,
    ogImageAlt: DEFAULT_IMAGE_ALT,
    lastmod: LASTMOD,
  },
  {
    path: "/terms",
    title: "Terms of Service | Bloomjoy",
    description: DEFAULT_DESCRIPTION,
    robots: PUBLIC_ROBOTS,
    surface: "marketing",
    ogType: "article",
    ogImagePath: DEFAULT_SHARE_IMAGE_PATH,
    ogImageAlt: DEFAULT_IMAGE_ALT,
    lastmod: LASTMOD,
  },
  {
    path: "/billing-cancellation",
    title: "Billing and Cancellation | Bloomjoy",
    description:
      "Understand billing cadence, cancellations, and account management for Bloomjoy services.",
    robots: PUBLIC_ROBOTS,
    surface: "marketing",
    ogType: "article",
    ogImagePath: DEFAULT_SHARE_IMAGE_PATH,
    ogImageAlt: DEFAULT_IMAGE_ALT,
    lastmod: LASTMOD,
  },
];

export const privateRoutes: PrivateRouteSeo[] = [
  {
    path: "/cart",
    canonicalOrigin: MARKETING_ORIGIN,
    title: "Bloomjoy Hub",
    description: DEFAULT_DESCRIPTION,
    robots: PRIVATE_ROBOTS,
    surface: "marketing",
    ogType: "website",
    ogImagePath: DEFAULT_SHARE_IMAGE_PATH,
    ogImageAlt: DEFAULT_IMAGE_ALT,
    lastmod: LASTMOD,
  },
  {
    path: "/login",
    canonicalOrigin: APP_ORIGIN,
    title: "Bloomjoy Operator App",
    description: DEFAULT_DESCRIPTION,
    robots: PRIVATE_ROBOTS,
    surface: "app",
    ogType: "website",
    ogImagePath: DEFAULT_SHARE_IMAGE_PATH,
    ogImageAlt: DEFAULT_IMAGE_ALT,
    lastmod: LASTMOD,
  },
  {
    path: "/refunds/request",
    canonicalOrigin: MARKETING_ORIGIN,
    title: "Refund Request | Bloomjoy",
    description:
      "Submit a Bloomjoy refund or product issue request for operations review.",
    robots: PRIVATE_ROBOTS,
    surface: "marketing",
    ogType: "website",
    ogImagePath: DEFAULT_SHARE_IMAGE_PATH,
    ogImageAlt: DEFAULT_IMAGE_ALT,
    lastmod: LASTMOD,
  },
  {
    path: "/refunds/thank-you",
    canonicalOrigin: MARKETING_ORIGIN,
    title: "Refund Request Received | Bloomjoy",
    description:
      "Confirmation page for Bloomjoy refund and product issue requests.",
    robots: PRIVATE_ROBOTS,
    surface: "marketing",
    ogType: "website",
    ogImagePath: DEFAULT_SHARE_IMAGE_PATH,
    ogImageAlt: DEFAULT_IMAGE_ALT,
    lastmod: LASTMOD,
  },
  {
    path: "/login/operator",
    canonicalOrigin: APP_ORIGIN,
    canonicalPath: "/login",
    title: "Bloomjoy Operator App",
    description: DEFAULT_DESCRIPTION,
    robots: PRIVATE_ROBOTS,
    surface: "app",
    ogType: "website",
    ogImagePath: DEFAULT_SHARE_IMAGE_PATH,
    ogImageAlt: DEFAULT_IMAGE_ALT,
    lastmod: LASTMOD,
  },
  ...[
    "/reset-password",
    "/portal",
    "/portal/orders",
    "/portal/account",
    "/portal/reports",
    "/portal/refunds",
    "/portal/training",
    "/portal/support",
    "/portal/onboarding",
    "/admin",
    "/admin/orders",
    "/admin/support",
    "/admin/accounts",
    "/admin/access",
    "/admin/partnerships",
    "/admin/reporting",
    "/admin/refunds",
    "/admin/audit",
  ].map(
    (path): PrivateRouteSeo => ({
      path,
      canonicalOrigin: APP_ORIGIN,
      title: "Bloomjoy Operator App",
      description: DEFAULT_DESCRIPTION,
      robots: PRIVATE_ROBOTS,
      surface: "app",
      ogType: "website",
      ogImagePath: DEFAULT_SHARE_IMAGE_PATH,
      ogImageAlt: DEFAULT_IMAGE_ALT,
      lastmod: LASTMOD,
    })
  ),
];

export const allSeoRoutes = [...publicRoutes, ...privateRoutes];

export const canonicalForPath = (origin: string, pathname: string) =>
  pathname === "/" ? `${origin}/` : `${origin}${pathname}`;

export const getRouteSeo = (pathname: string): RouteSeo => {
  const loginAlias = privateRoutes.find((route) => route.path === "/login/operator");
  const appRoute = privateRoutes.find((route) => route.path === pathname);
  const publicRoute = publicRoutes.find((route) => route.path === pathname);

  if (publicRoute) {
    return publicRoute;
  }

  if (appRoute) {
    return appRoute;
  }

  if (pathname.startsWith("/portal") || pathname.startsWith("/admin")) {
    return privateRoutes.find((route) => route.path === "/portal") ?? privateRoutes[0];
  }

  if (pathname === "/login/operator" && loginAlias) {
    return loginAlias;
  }

  return {
    path: pathname,
    title: "Page Not Found | Bloomjoy",
    description: DEFAULT_DESCRIPTION,
    robots: PRIVATE_ROBOTS,
    surface: "marketing",
    ogType: "website",
    ogImagePath: DEFAULT_SHARE_IMAGE_PATH,
    ogImageAlt: DEFAULT_IMAGE_ALT,
    lastmod: LASTMOD,
  };
};

const getRouteFaqs = (route: RouteSeo) => {
  if (route.path === "/resources") {
    return resourcesFaqs;
  }
  if (route.path === "/machines") {
    return machineBuyerFaqs;
  }
  if (route.path === "/machines/commercial-robotic-machine") {
    return commercialMachineFaqs;
  }
  if (route.path === "/machines/mini") {
    return miniMachineFaqs;
  }
  return [];
};

const getBusinessPlaybookArticleByPath = (path: string) => {
  const slug = path.replace("/resources/business-playbook/", "");
  return businessPlaybookArticles.find((article) => article.slug === slug);
};

const machineProductDataByPath: Record<string, Record<string, unknown>> = {
  "/machines/commercial-robotic-machine": {
    "@type": "Product",
    "@id": `${MARKETING_ORIGIN}/machines/commercial-robotic-machine#product`,
    name: "Bloomjoy Sweets Commercial Machine",
    brand: { "@type": "Brand", name: "Bloomjoy" },
    description:
      "Full-size commercial robotic cotton candy machine with automatic stick dispensing, 64 preset patterns, four sugar colors, and a 70-130 second candy cycle.",
    image: `${MARKETING_ORIGIN}/seo/commercial-machine.jpg`,
    url: `${MARKETING_ORIGIN}/machines/commercial-robotic-machine`,
    category: "Robotic cotton candy machine",
  },
  "/machines/mini": {
    "@type": "Product",
    "@id": `${MARKETING_ORIGIN}/machines/mini#product`,
    name: "Bloomjoy Sweets Mini Machine",
    brand: { "@type": "Brand", name: "Bloomjoy" },
    description:
      "Portable robotic cotton candy machine at one-fifth the size of the commercial unit, with most complex patterns, manual stick feeding, and roughly 90-second cycle guidance.",
    image: `${MARKETING_ORIGIN}/seo/mini-machine.jpg`,
    url: `${MARKETING_ORIGIN}/machines/mini`,
    category: "Robotic cotton candy machine",
  },
  "/machines/micro": {
    "@type": "Product",
    "@id": `${MARKETING_ORIGIN}/machines/micro#product`,
    name: "Bloomjoy Sweets Micro Machine",
    brand: { "@type": "Brand", name: "Bloomjoy" },
    description:
      "Entry-level robotic cotton candy machine for compact, low-volume applications and basic shapes.",
    image: `${MARKETING_ORIGIN}/seo/micro-machine.jpg`,
    url: `${MARKETING_ORIGIN}/machines/micro`,
    category: "Robotic cotton candy machine",
  },
};

const suppliesProducts = [
  {
    "@type": "Product",
    "@id": `${MARKETING_ORIGIN}/supplies#sugar`,
    name: "Bloomjoy Premium Cotton Candy Sugar",
    brand: { "@type": "Brand", name: "Bloomjoy" },
    description:
      "Bulk cotton candy sugar for Bloomjoy robotic cotton candy machines in white, blue, orange, and red options.",
    image: `${MARKETING_ORIGIN}/seo/supplies.jpg`,
    url: `${MARKETING_ORIGIN}/supplies?order=sugar`,
    category: "Cotton candy machine supplies",
    offers: {
      "@type": "Offer",
      price: "10.00",
      priceCurrency: "USD",
      url: `${MARKETING_ORIGIN}/supplies?order=sugar`,
    },
  },
  {
    "@type": "Product",
    "@id": `${MARKETING_ORIGIN}/supplies#branded-sticks`,
    name: "Bloomjoy Branded Paper Sticks",
    brand: { "@type": "Brand", name: "Bloomjoy" },
    description:
      "Bloomjoy branded paper sticks sold by box for Commercial/Full and Mini machine sizes.",
    image: `${MARKETING_ORIGIN}/seo/supplies.jpg`,
    url: `${MARKETING_ORIGIN}/supplies?order=sticks`,
    category: "Cotton candy machine supplies",
    offers: {
      "@type": "Offer",
      price: "130.00",
      priceCurrency: "USD",
      url: `${MARKETING_ORIGIN}/supplies?order=sticks`,
    },
  },
];

export const buildStructuredData = ({
  route,
  origin,
  canonicalUrl,
}: {
  route: RouteSeo;
  origin: string;
  canonicalUrl: string;
}) => {
  const graph: Array<Record<string, unknown>> = [
    {
      "@type": "Organization",
      "@id": `${MARKETING_ORIGIN}/#organization`,
      name: ORGANIZATION_NAME,
      url: `${MARKETING_ORIGIN}/`,
      logo: `${MARKETING_ORIGIN}${ORGANIZATION_LOGO_PATH}`,
    },
    {
      "@type": "WebSite",
      "@id": `${MARKETING_ORIGIN}/#website`,
      name: WEBSITE_NAME,
      url: `${MARKETING_ORIGIN}/`,
      publisher: {
        "@id": `${MARKETING_ORIGIN}/#organization`,
      },
    },
    {
      "@type": "WebPage",
      "@id": `${canonicalUrl}#webpage`,
      url: canonicalUrl,
      name: route.title,
      description: route.description,
      isPartOf: {
        "@id": `${MARKETING_ORIGIN}/#website`,
      },
      about: {
        "@id": `${MARKETING_ORIGIN}/#organization`,
      },
    },
  ];

  if (route.path.startsWith("/machines/")) {
    graph.push({
      "@type": "BreadcrumbList",
      "@id": `${canonicalUrl}#breadcrumb`,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Machines",
          item: `${MARKETING_ORIGIN}/machines`,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: route.title.replace(" | Bloomjoy", ""),
          item: canonicalUrl,
        },
      ],
    });
  }

  if (route.path === "/resources/business-playbook") {
    graph.push({
      "@type": "CollectionPage",
      "@id": `${canonicalUrl}#collection`,
      name: "Bloomjoy Business Playbook",
      description: route.description,
      url: canonicalUrl,
      isPartOf: {
        "@id": `${MARKETING_ORIGIN}/#website`,
      },
      mainEntity: {
        "@type": "ItemList",
        itemListElement: businessPlaybookArticles.map((article, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: article.title,
          url: `${MARKETING_ORIGIN}/resources/business-playbook/${article.slug}`,
        })),
      },
    });
  }

  if (route.structuredDataKind === "business-playbook-article") {
    const article = getBusinessPlaybookArticleByPath(route.path);

    if (article) {
      graph.push(
        {
          "@type": "BreadcrumbList",
          "@id": `${canonicalUrl}#breadcrumb`,
          itemListElement: [
            {
              "@type": "ListItem",
              position: 1,
              name: "Resources",
              item: `${MARKETING_ORIGIN}/resources`,
            },
            {
              "@type": "ListItem",
              position: 2,
              name: "Business Playbook",
              item: `${MARKETING_ORIGIN}/resources/business-playbook`,
            },
            {
              "@type": "ListItem",
              position: 3,
              name: article.title,
              item: canonicalUrl,
            },
          ],
        },
        {
          "@type": "Article",
          "@id": `${canonicalUrl}#article`,
          headline: article.title,
          description: article.description,
          image: `${MARKETING_ORIGIN}${article.seoImagePath}`,
          datePublished: article.updatedAt,
          dateModified: article.updatedAt,
          author: {
            "@id": `${MARKETING_ORIGIN}/#organization`,
          },
          publisher: {
            "@id": `${MARKETING_ORIGIN}/#organization`,
          },
          mainEntityOfPage: {
            "@id": `${canonicalUrl}#webpage`,
          },
          about: article.keyTakeaways,
          citation: article.citations.map((citation) => citation.url),
        }
      );
    }
  }

  if (route.structuredDataKind === "machine-product" && machineProductDataByPath[route.path]) {
    graph.push(machineProductDataByPath[route.path]);
  }

  if (route.structuredDataKind === "supplies") {
    graph.push(...suppliesProducts);
  }

  const faqs = getRouteFaqs(route);
  if (faqs.length > 0) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${canonicalUrl}#faq`,
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.q,
        acceptedAnswer: {
          "@type": "Answer",
          text: faq.a,
        },
      })),
    });
  }

  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
};

export const getShareImageUrl = (origin: string, route: Pick<RouteSeo, "ogImagePath">) =>
  `${origin}${route.ogImagePath ?? DEFAULT_SHARE_IMAGE_PATH}`;

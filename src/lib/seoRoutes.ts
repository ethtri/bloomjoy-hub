import type { AppSurface } from "@/lib/appSurface";

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
  structuredDataKind?: "machine-product" | "supplies" | "faq";
};

export type PrivateRouteSeo = RouteSeo & {
  title: "Bloomjoy Hub" | "Bloomjoy Operator App";
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

const LASTMOD = "2026-04-17";

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
    a: "Commercial is full-size with automatic stick dispensing and the deepest pattern set. Mini is portable with manual stick feeding. Micro is the entry-level machine for basic shapes only.",
  },
  {
    q: "Can Bloomjoy help my team learn daily operation?",
    a: "Yes. Bloomjoy Plus includes task-based training, operator guides, maintenance checklists, and the Operator Essentials completion certificate path.",
  },
  {
    q: "What should I know before requesting a machine quote?",
    a: "Bring your target venue type, expected volume, delivery location, preferred machine model, and any wrap or supplies needs so Bloomjoy can confirm fit and next steps.",
  },
  {
    q: "Which sugar and stick supplies are available?",
    a: "Bloomjoy sells bulk cotton candy sugar in core colors, Bloomjoy branded paper sticks by box, and custom stick requests with artwork proofing.",
  },
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
      "Explore the Bloomjoy Mini Machine, a portable robotic cotton candy option with most complex patterns, manual stick feeding, and quote-led ordering.",
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
    title: "Robotic Cotton Candy Machine FAQs and Resources | Bloomjoy",
    description:
      "Get practical answers about Bloomjoy robotic cotton candy machines, supplies, training, support boundaries, maintenance, and quote preparation.",
    robots: PUBLIC_ROBOTS,
    surface: "marketing",
    ogImagePath: DEFAULT_SHARE_IMAGE_PATH,
    ogImageAlt: "Bloomjoy machine buyer resources",
    lastmod: LASTMOD,
    structuredDataKind: "faq",
  },
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
  return [];
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
      "Portable robotic cotton candy machine at one-fifth the size of the commercial unit, with most complex patterns and manual stick feeding.",
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

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DIST_DIR = path.resolve(process.cwd(), "dist");
const TEMPLATE_PATH = path.join(DIST_DIR, "index.html");

const MARKETING_ORIGIN = "https://www.bloomjoyusa.com";
const APP_ORIGIN = "https://app.bloomjoyusa.com";
const PUBLIC_ROBOTS =
  "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1";
const PRIVATE_ROBOTS = "noindex,nofollow,noarchive,nosnippet";
const DEFAULT_IMAGE = `${MARKETING_ORIGIN}/favicon.svg`;
const DEFAULT_DESCRIPTION =
  "Bloomjoy Hub for robotic cotton candy machines, supplies, training, and support.";
const WEBSITE_NAME = "Bloomjoy Hub";
const ORGANIZATION_NAME = "Bloomjoy";
const STRUCTURED_DATA_SCRIPT_ID = "seo-structured-data";

const publicRoutes = [
  {
    path: "/",
    title: "Bloomjoy Hub | Robotic Cotton Candy Machines and Supplies",
    description:
      "Explore Bloomjoy robotic cotton candy machines, sugar supplies, and optional Plus support for operators.",
    ogType: "website",
  },
  {
    path: "/machines",
    title: "Machines | Bloomjoy Hub",
    description:
      "Compare Bloomjoy machine options and find the right cotton candy setup for your venue.",
    ogType: "website",
  },
  {
    path: "/machines/commercial-robotic-machine",
    title: "Commercial Robotic Machine | Bloomjoy Hub",
    description:
      "Review the Bloomjoy commercial robotic cotton candy machine, specs, operating footprint, and quote flow.",
    ogType: "website",
  },
  {
    path: "/machines/mini",
    title: "Mini Machine | Bloomjoy Hub",
    description:
      "Learn about Bloomjoy Mini and join the waitlist for upcoming availability and launch updates.",
    ogType: "website",
  },
  {
    path: "/machines/micro",
    title: "Micro Machine | Bloomjoy Hub",
    description:
      "Explore Bloomjoy Micro machine details, features, and setup fit for compact locations.",
    ogType: "website",
  },
  {
    path: "/supplies",
    title: "Supplies | Bloomjoy Hub",
    description:
      "Order Bloomjoy cotton candy sugar and supplies with high-volume-friendly quantity controls.",
    ogType: "website",
  },
  {
    path: "/plus",
    title: "Bloomjoy Plus | Membership",
    description:
      "View Bloomjoy Plus membership benefits, support boundaries, and per-machine monthly pricing.",
    ogType: "website",
  },
  {
    path: "/resources",
    title: "Resources and FAQs | Bloomjoy Hub",
    description:
      "Get quick answers on training, support boundaries, and how Bloomjoy operations work.",
    ogType: "website",
  },
  {
    path: "/contact",
    title: "Contact and Quote Requests | Bloomjoy Hub",
    description:
      "Contact Bloomjoy for machine quotes, demo requests, procurement questions, and general support.",
    ogType: "website",
  },
  {
    path: "/about",
    title: "About Bloomjoy | Operator-Focused Support",
    description:
      "Meet Bloomjoy and our operator-focused approach to machines, training, and field support.",
    ogType: "website",
  },
  {
    path: "/privacy",
    title: "Privacy Policy | Bloomjoy Hub",
    description:
      "Bloomjoy Hub for robotic cotton candy machines, supplies, training, and support.",
    ogType: "article",
  },
  {
    path: "/terms",
    title: "Terms of Service | Bloomjoy Hub",
    description:
      "Bloomjoy Hub for robotic cotton candy machines, supplies, training, and support.",
    ogType: "article",
  },
  {
    path: "/billing-cancellation",
    title: "Billing and Cancellation | Bloomjoy Hub",
    description:
      "Understand billing cadence, cancellations, and account management for Bloomjoy services.",
    ogType: "article",
  },
];

const privateRoutes = [
  { path: "/cart", canonicalOrigin: MARKETING_ORIGIN, title: "Bloomjoy Hub" },
  { path: "/login", canonicalOrigin: APP_ORIGIN, title: "Bloomjoy Operator App" },
  {
    path: "/login/operator",
    canonicalOrigin: APP_ORIGIN,
    canonicalPath: "/login",
    title: "Bloomjoy Operator App",
  },
  { path: "/reset-password", canonicalOrigin: APP_ORIGIN, title: "Bloomjoy Operator App" },
  { path: "/portal", canonicalOrigin: APP_ORIGIN, title: "Bloomjoy Operator App" },
  { path: "/portal/orders", canonicalOrigin: APP_ORIGIN, title: "Bloomjoy Operator App" },
  { path: "/portal/account", canonicalOrigin: APP_ORIGIN, title: "Bloomjoy Operator App" },
  { path: "/portal/training", canonicalOrigin: APP_ORIGIN, title: "Bloomjoy Operator App" },
  { path: "/portal/support", canonicalOrigin: APP_ORIGIN, title: "Bloomjoy Operator App" },
  { path: "/portal/onboarding", canonicalOrigin: APP_ORIGIN, title: "Bloomjoy Operator App" },
  { path: "/admin", canonicalOrigin: APP_ORIGIN, title: "Bloomjoy Operator App" },
  { path: "/admin/orders", canonicalOrigin: APP_ORIGIN, title: "Bloomjoy Operator App" },
  { path: "/admin/support", canonicalOrigin: APP_ORIGIN, title: "Bloomjoy Operator App" },
  { path: "/admin/accounts", canonicalOrigin: APP_ORIGIN, title: "Bloomjoy Operator App" },
  { path: "/admin/audit", canonicalOrigin: APP_ORIGIN, title: "Bloomjoy Operator App" },
];

const escapeAttribute = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const escapeScriptContent = (value) => value.replaceAll("</script>", "<\\/script>");

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const upsertMetaTag = (html, attribute, key, content) => {
  const tag = `<meta ${attribute}="${key}" content="${escapeAttribute(content)}" />`;
  const pattern = new RegExp(
    `<meta[^>]*${attribute}=["']${escapeRegex(key)}["'][^>]*>`,
    "i"
  );

  if (pattern.test(html)) {
    return html.replace(pattern, tag);
  }

  return html.replace("</head>", `  ${tag}\n  </head>`);
};

const upsertCanonical = (html, href) => {
  const tag = `<link rel="canonical" href="${escapeAttribute(href)}" />`;
  const pattern = /<link[^>]*rel=["']canonical["'][^>]*>/i;

  if (pattern.test(html)) {
    return html.replace(pattern, tag);
  }

  return html.replace("</head>", `  ${tag}\n  </head>`);
};

const upsertStructuredDataScript = (html, data) => {
  const script = `<script id="${STRUCTURED_DATA_SCRIPT_ID}" type="application/ld+json">${escapeScriptContent(
    JSON.stringify(data)
  )}</script>`;
  const pattern = new RegExp(
    `<script[^>]*id=["']${escapeRegex(STRUCTURED_DATA_SCRIPT_ID)}["'][^>]*>[\\s\\S]*?<\\/script>`,
    "i"
  );

  if (pattern.test(html)) {
    return html.replace(pattern, script);
  }

  return html.replace("</head>", `  ${script}\n  </head>`);
};

const removeStructuredDataScript = (html) =>
  html.replace(
    new RegExp(
      `<script[^>]*id=["']${escapeRegex(STRUCTURED_DATA_SCRIPT_ID)}["'][^>]*>[\\s\\S]*?<\\/script>\\s*`,
      "i"
    ),
    ""
  );

const upsertTitle = (html, title) =>
  html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeAttribute(title)}</title>`);

const canonicalForPath = (origin, pathname) =>
  pathname === "/" ? `${origin}/` : `${origin}${pathname}`;

const buildStructuredData = ({ canonicalUrl, title, description }) => ({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${MARKETING_ORIGIN}/#organization`,
      name: ORGANIZATION_NAME,
      url: `${MARKETING_ORIGIN}/`,
      logo: DEFAULT_IMAGE,
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
      name: title,
      description,
      isPartOf: {
        "@id": `${MARKETING_ORIGIN}/#website`,
      },
      about: {
        "@id": `${MARKETING_ORIGIN}/#organization`,
      },
    },
  ],
});

const withSeoTags = (template, route) => {
  const canonicalUrl = canonicalForPath(MARKETING_ORIGIN, route.path);
  let html = template;

  html = upsertTitle(html, route.title);
  html = upsertMetaTag(html, "name", "description", route.description);
  html = upsertMetaTag(html, "name", "robots", PUBLIC_ROBOTS);
  html = upsertMetaTag(html, "property", "og:title", route.title);
  html = upsertMetaTag(html, "property", "og:description", route.description);
  html = upsertMetaTag(html, "property", "og:type", route.ogType);
  html = upsertMetaTag(html, "property", "og:url", canonicalUrl);
  html = upsertMetaTag(html, "property", "og:image", DEFAULT_IMAGE);
  html = upsertMetaTag(html, "name", "twitter:card", "summary_large_image");
  html = upsertMetaTag(html, "name", "twitter:title", route.title);
  html = upsertMetaTag(html, "name", "twitter:description", route.description);
  html = upsertMetaTag(html, "name", "twitter:image", DEFAULT_IMAGE);
  html = upsertCanonical(html, canonicalUrl);
  html = upsertStructuredDataScript(
    html,
    buildStructuredData({
      canonicalUrl,
      title: route.title,
      description: route.description,
    })
  );

  return html;
};

const withPrivateSeoTags = (template, route) => {
  const canonicalUrl = canonicalForPath(
    route.canonicalOrigin,
    route.canonicalPath ?? route.path
  );
  let html = template;

  html = upsertTitle(html, route.title);
  html = upsertMetaTag(html, "name", "description", DEFAULT_DESCRIPTION);
  html = upsertMetaTag(html, "name", "robots", PRIVATE_ROBOTS);
  html = upsertMetaTag(html, "property", "og:title", route.title);
  html = upsertMetaTag(html, "property", "og:description", DEFAULT_DESCRIPTION);
  html = upsertMetaTag(html, "property", "og:type", "website");
  html = upsertMetaTag(html, "property", "og:url", canonicalUrl);
  html = upsertMetaTag(html, "property", "og:image", DEFAULT_IMAGE);
  html = upsertMetaTag(html, "name", "twitter:card", "summary_large_image");
  html = upsertMetaTag(html, "name", "twitter:title", route.title);
  html = upsertMetaTag(html, "name", "twitter:description", DEFAULT_DESCRIPTION);
  html = upsertMetaTag(html, "name", "twitter:image", DEFAULT_IMAGE);
  html = upsertCanonical(html, canonicalUrl);
  html = removeStructuredDataScript(html);

  return html;
};

const outputFileForRoute = (pathname) => {
  if (pathname === "/") {
    return path.join(DIST_DIR, "index.html");
  }

  return path.join(DIST_DIR, pathname.replace(/^\//, ""), "index.html");
};

const main = async () => {
  const template = await readFile(TEMPLATE_PATH, "utf8");

  for (const route of publicRoutes) {
    const rendered = withSeoTags(template, route);
    const outputPath = outputFileForRoute(route.path);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, rendered, "utf8");
  }

  for (const route of privateRoutes) {
    const rendered = withPrivateSeoTags(template, route);
    const outputPath = outputFileForRoute(route.path);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, rendered, "utf8");
  }

  console.log(
    `Prerendered SEO HTML for ${publicRoutes.length} public routes and ${privateRoutes.length} private routes.`
  );
};

await main();

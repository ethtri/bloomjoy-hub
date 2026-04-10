import { readFile } from "node:fs/promises";
import path from "node:path";

const DIST_DIR = path.resolve(process.cwd(), "dist");
const VERCEL_CONFIG_PATH = path.resolve(process.cwd(), "vercel.json");

const PUBLIC_ROBOTS =
  "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1";
const PRIVATE_ROBOTS = "noindex,nofollow,noarchive,nosnippet";
const STRUCTURED_DATA_SCRIPT_ID = "seo-structured-data";
const SITEMAP_URL = "https://www.bloomjoyusa.com/sitemap.xml";
const MARKETING_CANONICAL_HOST = "https://www.bloomjoyusa.com";
const APP_CANONICAL_HOST = "https://app.bloomjoyusa.com";

const publicRoutes = [
  "/",
  "/machines",
  "/machines/commercial-robotic-machine",
  "/machines/mini",
  "/machines/micro",
  "/supplies",
  "/plus",
  "/resources",
  "/contact",
  "/about",
  "/privacy",
  "/terms",
  "/billing-cancellation",
];

const privateRoutes = [
  { path: "/cart", canonicalOrigin: MARKETING_CANONICAL_HOST, title: "Bloomjoy Hub" },
  { path: "/login", canonicalOrigin: APP_CANONICAL_HOST, title: "Bloomjoy Operator App" },
  {
    path: "/login/operator",
    canonicalOrigin: APP_CANONICAL_HOST,
    canonicalPath: "/login",
    title: "Bloomjoy Operator App",
  },
  { path: "/reset-password", canonicalOrigin: APP_CANONICAL_HOST, title: "Bloomjoy Operator App" },
  { path: "/portal", canonicalOrigin: APP_CANONICAL_HOST, title: "Bloomjoy Operator App" },
  { path: "/portal/orders", canonicalOrigin: APP_CANONICAL_HOST, title: "Bloomjoy Operator App" },
  { path: "/portal/account", canonicalOrigin: APP_CANONICAL_HOST, title: "Bloomjoy Operator App" },
  { path: "/portal/training", canonicalOrigin: APP_CANONICAL_HOST, title: "Bloomjoy Operator App" },
  { path: "/portal/support", canonicalOrigin: APP_CANONICAL_HOST, title: "Bloomjoy Operator App" },
  { path: "/portal/onboarding", canonicalOrigin: APP_CANONICAL_HOST, title: "Bloomjoy Operator App" },
  { path: "/admin", canonicalOrigin: APP_CANONICAL_HOST, title: "Bloomjoy Operator App" },
  { path: "/admin/orders", canonicalOrigin: APP_CANONICAL_HOST, title: "Bloomjoy Operator App" },
  { path: "/admin/support", canonicalOrigin: APP_CANONICAL_HOST, title: "Bloomjoy Operator App" },
  { path: "/admin/accounts", canonicalOrigin: APP_CANONICAL_HOST, title: "Bloomjoy Operator App" },
  { path: "/admin/audit", canonicalOrigin: APP_CANONICAL_HOST, title: "Bloomjoy Operator App" },
];

const routeToDistHtml = (routePath) => {
  if (routePath === "/") {
    return path.join(DIST_DIR, "index.html");
  }
  return path.join(DIST_DIR, routePath.replace(/^\//, ""), "index.html");
};

const canonicalForRoute = (origin, routePath) =>
  routePath === "/" ? `${origin}/` : `${origin}${routePath}`;

const assertIncludes = (text, expected, failureMessage) => {
  if (!text.includes(expected)) {
    throw new Error(failureMessage);
  }
};

const assertExcludes = (text, forbidden, failureMessage) => {
  if (text.includes(forbidden)) {
    throw new Error(failureMessage);
  }
};

const validatePublicRouteHtml = async (routePath) => {
  const html = await readFile(routeToDistHtml(routePath), "utf8");
  const canonical = canonicalForRoute(MARKETING_CANONICAL_HOST, routePath);

  assertIncludes(
    html,
    `<meta name="robots" content="${PUBLIC_ROBOTS}"`,
    `Public route ${routePath} is missing indexable robots meta`
  );
  assertIncludes(
    html,
    `<link rel="canonical" href="${canonical}"`,
    `Public route ${routePath} has incorrect canonical link`
  );
  assertIncludes(
    html,
    `<script id="${STRUCTURED_DATA_SCRIPT_ID}" type="application/ld+json">`,
    `Public route ${routePath} is missing JSON-LD script`
  );
  assertIncludes(
    html,
    `"@type":"WebPage"`,
    `Public route ${routePath} JSON-LD is missing WebPage node`
  );
  assertIncludes(
    html,
    `"url":"${canonical}"`,
    `Public route ${routePath} JSON-LD is missing canonical url`
  );

  if (routePath === "/machines/mini") {
    assertExcludes(
      html,
      "join the waitlist",
      "Mini route prerender still references waitlist copy"
    );
    assertExcludes(
      html,
      "upcoming availability",
      "Mini route prerender still references upcoming-availability copy"
    );
  }
};

const validatePrivateRouteHtml = async (route) => {
  const html = await readFile(routeToDistHtml(route.path), "utf8");
  const canonical = canonicalForRoute(
    route.canonicalOrigin,
    route.canonicalPath ?? route.path
  );

  assertIncludes(
    html,
    `<meta name="robots" content="${PRIVATE_ROBOTS}"`,
    `Private route ${route.path} is missing noindex robots meta`
  );
  assertIncludes(
    html,
    `<link rel="canonical" href="${canonical}"`,
    `Private route ${route.path} has incorrect canonical link`
  );
  assertIncludes(
    html,
    `<title>${route.title}</title>`,
    `Private route ${route.path} has incorrect title`
  );
  assertExcludes(
    html,
    `<script id="${STRUCTURED_DATA_SCRIPT_ID}" type="application/ld+json">`,
    `Private route ${route.path} should not include JSON-LD script`
  );
};

const validateRobots = async () => {
  const robots = await readFile(path.join(DIST_DIR, "robots.txt"), "utf8");

  assertIncludes(
    robots,
    `Sitemap: ${SITEMAP_URL}`,
    "robots.txt is missing sitemap reference"
  );
};

const validateSitemap = async () => {
  const sitemap = await readFile(path.join(DIST_DIR, "sitemap.xml"), "utf8");

  for (const routePath of publicRoutes) {
    const canonical = canonicalForRoute(MARKETING_CANONICAL_HOST, routePath);
    assertIncludes(
      sitemap,
      `<loc>${canonical}</loc>`,
      `sitemap.xml is missing route ${routePath}`
    );
  }
};

const hasHostRedirectRule = (routes) =>
  routes.some(
    (route) =>
      route?.src === "/(.*)" &&
      route?.status === 308 &&
      route?.headers?.Location === "https://www.bloomjoyusa.com/$1" &&
      Array.isArray(route?.has) &&
      route.has.some(
        (condition) => condition?.type === "host" && condition?.value === "bloomjoyusa.com"
      )
  );

const hasLegacyProductsRedirectRule = (routes) => {
  const directProducts = routes.some(
    (route) =>
      route?.src === "/products/?" &&
      route?.status === 308 &&
      route?.headers?.Location === "/machines"
  );
  const detailProducts = routes.some(
    (route) =>
      route?.src === "/products/(commercial-robotic-machine|mini|micro)/?" &&
      route?.status === 308 &&
      route?.headers?.Location === "/machines/$1"
  );

  return directProducts && detailProducts;
};

const hasWwwToAppRedirectRule = (routes) =>
  routes.some(
    (route) =>
      route?.src === "/(login(?:/operator)?|reset-password|portal(?:/.*)?|admin(?:/.*)?)" &&
      route?.status === 308 &&
      route?.headers?.Location === "https://app.bloomjoyusa.com/$1" &&
      Array.isArray(route?.has) &&
      route.has.some(
        (condition) =>
          condition?.type === "host" && condition?.value === "www.bloomjoyusa.com"
      )
  );

const hasAppToWwwRedirectRules = (routes) => {
  const rootRedirect = routes.some(
    (route) =>
      route?.src === "/" &&
      route?.status === 308 &&
      route?.headers?.Location === "https://www.bloomjoyusa.com/" &&
      Array.isArray(route?.has) &&
      route.has.some(
        (condition) => condition?.type === "host" && condition?.value === "app.bloomjoyusa.com"
      )
  );

  const groupedRedirect = routes.some(
    (route) =>
      route?.src === "/(machines(?:/.*)?|products(?:/.*)?|supplies|plus|resources|about|contact|privacy|terms|billing-cancellation|cart)" &&
      route?.status === 308 &&
      route?.headers?.Location === "https://www.bloomjoyusa.com/$1" &&
      Array.isArray(route?.has) &&
      route.has.some(
        (condition) => condition?.type === "host" && condition?.value === "app.bloomjoyusa.com"
      )
  );

  return rootRedirect && groupedRedirect;
};

const validateVercelConfig = async () => {
  const raw = await readFile(VERCEL_CONFIG_PATH, "utf8");
  const parsed = JSON.parse(raw);
  const routes = Array.isArray(parsed?.routes) ? parsed.routes : [];

  if (!hasHostRedirectRule(routes)) {
    throw new Error("vercel.json is missing apex->www 308 host redirect rule");
  }

  if (!hasLegacyProductsRedirectRule(routes)) {
    throw new Error("vercel.json is missing legacy /products* -> /machines* redirect rules");
  }

  if (!hasWwwToAppRedirectRule(routes)) {
    throw new Error("vercel.json is missing www -> app redirect rules for private app routes");
  }

  if (!hasAppToWwwRedirectRules(routes)) {
    throw new Error("vercel.json is missing app -> www redirect rules for public marketing routes");
  }
};

const main = async () => {
  await validateRobots();
  await validateSitemap();
  await validateVercelConfig();

  for (const routePath of publicRoutes) {
    await validatePublicRouteHtml(routePath);
  }

  for (const route of privateRoutes) {
    await validatePrivateRouteHtml(route);
  }

  console.log(
    `SEO regression checks passed: ${publicRoutes.length} public routes and ${privateRoutes.length} private routes validated.`
  );
};

await main();

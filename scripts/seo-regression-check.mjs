import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

process.env.VITE_SUPABASE_URL ||= "https://example.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY ||= "prerender-anon-key";

const DIST_DIR = path.resolve(process.cwd(), "dist");
const VERCEL_CONFIG_PATH = path.resolve(process.cwd(), "vercel.json");
const SITEMAP_URL = "https://www.bloomjoyusa.com/sitemap.xml";

const routeToDistHtml = (routePath) => {
  if (routePath === "/") {
    return path.join(DIST_DIR, "index.html");
  }
  return path.join(DIST_DIR, routePath.replace(/^\//, ""), "index.html");
};

const routeToCleanHtml = (routePath) => {
  if (routePath === "/") {
    return path.join(DIST_DIR, "index.html");
  }
  return path.join(DIST_DIR, `${routePath.replace(/^\//, "")}.html`);
};

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

const assertMatches = (text, pattern, failureMessage) => {
  if (!pattern.test(text)) {
    throw new Error(failureMessage);
  }
};

const expectedH1TextByRoute = {
  "/": "Robotic cotton candy",
  "/machines": "Robotic Cotton Candy Machines for Operators",
  "/machines/commercial-robotic-machine": "Bloomjoy Sweets Commercial Machine",
  "/machines/mini": "Bloomjoy Sweets Mini Machine",
  "/machines/micro": "Bloomjoy Sweets Micro Machine",
  "/supplies": "Cotton Candy Machine Sugar and Paper Sticks",
  "/plus": "Onboarding + Playbooks + Concierge",
  "/resources": "Resources",
  "/contact": "Contact Us",
  "/about": "About Bloomjoy",
  "/privacy": "Privacy Policy",
  "/terms": "Terms of Service",
  "/billing-cancellation": "Billing and Cancellation",
};

const loadSeoRoutes = async () => {
  const vite = await createServer({
    appType: "custom",
    logLevel: "error",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  });

  try {
    const seoRoutes = await vite.ssrLoadModule("/src/lib/seoRoutes.ts");
    return { vite, seoRoutes };
  } catch (error) {
    await vite.close();
    throw error;
  }
};

const validatePublicRouteHtml = async (route, seoRoutes) => {
  const html = await readFile(routeToDistHtml(route.path), "utf8");
  const canonical = seoRoutes.canonicalForPath(seoRoutes.MARKETING_ORIGIN, route.path);
  const expectedH1Text = expectedH1TextByRoute[route.path];

  assertIncludes(
    html,
    `<meta name="robots" content="${seoRoutes.PUBLIC_ROBOTS}"`,
    `Public route ${route.path} is missing indexable robots meta`
  );
  assertIncludes(
    html,
    `<link rel="canonical" href="${canonical}"`,
    `Public route ${route.path} has incorrect canonical link`
  );
  assertIncludes(
    html,
    `<script id="${seoRoutes.STRUCTURED_DATA_SCRIPT_ID}" type="application/ld+json">`,
    `Public route ${route.path} is missing JSON-LD script`
  );
  assertIncludes(
    html,
    `"@type":"WebPage"`,
    `Public route ${route.path} JSON-LD is missing WebPage node`
  );
  assertIncludes(
    html,
    `"url":"${canonical}"`,
    `Public route ${route.path} JSON-LD is missing canonical url`
  );
  assertIncludes(
    html,
    'id="root" data-prerendered="true"',
    `Public route ${route.path} root was not marked as prerendered`
  );
  assertExcludes(
    html,
    '<div id="root"></div>',
    `Public route ${route.path} still has an empty root`
  );
  assertExcludes(
    html,
    "/src/assets/",
    `Public route ${route.path} contains dev-time source asset URLs`
  );
  assertMatches(html, /<h1[\s>]/i, `Public route ${route.path} is missing source HTML H1`);

  if (expectedH1Text) {
    assertIncludes(
      html,
      expectedH1Text,
      `Public route ${route.path} is missing expected H1/source text: ${expectedH1Text}`
    );
  }

  if (route.path.startsWith("/machines/")) {
    assertIncludes(
      html,
      `"@type":"Product"`,
      `Machine route ${route.path} is missing Product JSON-LD`
    );
    assertIncludes(
      html,
      `"@type":"BreadcrumbList"`,
      `Machine route ${route.path} is missing BreadcrumbList JSON-LD`
    );
  }

  if (route.path === "/machines" || route.path === "/machines/commercial-robotic-machine" || route.path === "/resources") {
    assertIncludes(
      html,
      `"@type":"FAQPage"`,
      `FAQ route ${route.path} is missing FAQPage JSON-LD`
    );

    const visibleFaqAnswer =
      route.path === "/machines"
        ? seoRoutes.machineBuyerFaqs[0]?.a
        : route.path === "/machines/commercial-robotic-machine"
          ? seoRoutes.commercialMachineFaqs[0]?.a
          : seoRoutes.resourcesFaqs[0]?.a;

    if (visibleFaqAnswer) {
      assertIncludes(
        html,
        visibleFaqAnswer,
        `FAQ route ${route.path} is missing visible FAQ answer text`
      );
    }
  }

  if (route.path === "/supplies") {
    assertIncludes(html, `"@type":"Offer"`, "Supplies route is missing Offer JSON-LD");
    assertIncludes(html, `"price":"10.00"`, "Supplies route is missing sugar price Offer");
    assertIncludes(html, `"price":"130.00"`, "Supplies route is missing sticks price Offer");
  }

  if (route.path === "/machines/mini") {
    assertExcludes(
      html.toLowerCase(),
      "join the waitlist",
      "Mini route prerender still references waitlist copy"
    );
    assertExcludes(
      html.toLowerCase(),
      "upcoming availability",
      "Mini route prerender still references upcoming-availability copy"
    );
  }

  if (route.path !== "/") {
    const cleanHtml = await readFile(routeToCleanHtml(route.path), "utf8");
    assertIncludes(
      cleanHtml,
      `<link rel="canonical" href="${canonical}"`,
      `Clean URL HTML file for ${route.path} has incorrect canonical link`
    );
    assertIncludes(
      cleanHtml,
      'id="root" data-prerendered="true"',
      `Clean URL HTML file for ${route.path} is missing prerendered body content`
    );
    assertExcludes(
      cleanHtml,
      "/src/assets/",
      `Clean URL HTML file for ${route.path} contains dev-time source asset URLs`
    );
    if (expectedH1Text) {
      assertIncludes(
        cleanHtml,
        expectedH1Text,
        `Clean URL HTML file for ${route.path} is missing expected source text`
      );
    }
  }
};

const validatePrivateRouteHtml = async (route, seoRoutes) => {
  const html = await readFile(routeToDistHtml(route.path), "utf8");
  const canonical = seoRoutes.canonicalForPath(
    route.canonicalOrigin,
    route.canonicalPath ?? route.path
  );

  assertIncludes(
    html,
    `<meta name="robots" content="${seoRoutes.PRIVATE_ROBOTS}"`,
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
  assertIncludes(
    html,
    '<div id="root"></div>',
    `Private route ${route.path} should keep an empty app root`
  );
  assertExcludes(
    html,
    `<script id="${seoRoutes.STRUCTURED_DATA_SCRIPT_ID}" type="application/ld+json">`,
    `Private route ${route.path} should not include JSON-LD script`
  );

  if (route.path !== "/") {
    const cleanHtml = await readFile(routeToCleanHtml(route.path), "utf8");
    assertIncludes(
      cleanHtml,
      `<meta name="robots" content="${seoRoutes.PRIVATE_ROBOTS}"`,
      `Clean URL HTML file for private route ${route.path} is missing noindex robots meta`
    );
    assertIncludes(
      cleanHtml,
      '<div id="root"></div>',
      `Clean URL HTML file for private route ${route.path} should keep an empty app root`
    );
  }
};

const validateRobots = async () => {
  const robots = await readFile(path.join(DIST_DIR, "robots.txt"), "utf8");

  assertIncludes(
    robots,
    `Sitemap: ${SITEMAP_URL}`,
    "robots.txt is missing sitemap reference"
  );
};

const validateSitemap = async (seoRoutes) => {
  const sitemap = await readFile(path.join(DIST_DIR, "sitemap.xml"), "utf8");

  assertIncludes(
    sitemap,
    'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"',
    "sitemap.xml is missing image sitemap namespace"
  );

  for (const route of seoRoutes.publicRoutes) {
    const canonical = seoRoutes.canonicalForPath(seoRoutes.MARKETING_ORIGIN, route.path);
    assertIncludes(
      sitemap,
      `<loc>${canonical}</loc>`,
      `sitemap.xml is missing route ${route.path}`
    );
    assertIncludes(
      sitemap,
      `<lastmod>${route.lastmod}</lastmod>`,
      `sitemap.xml is missing lastmod for ${route.path}`
    );

    for (const image of route.sitemapImages ?? []) {
      assertIncludes(
        sitemap,
        `<image:loc>${image.loc}</image:loc>`,
        `sitemap.xml is missing image entry for ${route.path}`
      );
    }
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

const hasStaticPrerenderRewriteRules = (routes) => {
  const machineDetailRewrite = routes.some(
    (route) =>
      route?.src === "/machines/(commercial-robotic-machine|mini|micro)/?" &&
      route?.dest === "/machines/$1.html"
  );

  const publicRewrite = routes.some(
    (route) =>
      route?.src === "/(machines|supplies|plus|resources|about|contact|privacy|terms|billing-cancellation)/?" &&
      route?.dest === "/$1.html"
  );

  const authPrivateRewrite = routes.some(
    (route) =>
      route?.src === "/(cart|login(?:/operator)?|reset-password)/?" &&
      route?.dest === "/$1.html"
  );

  const portalCatchAllRewrite = routes.some(
    (route) =>
      route?.src === "/portal(?:/.*)?/?" &&
      route?.dest === "/portal.html"
  );

  const adminCatchAllRewrite = routes.some(
    (route) =>
      route?.src === "/admin(?:/.*)?/?" &&
      route?.dest === "/admin.html"
  );

  return (
    machineDetailRewrite &&
    publicRewrite &&
    authPrivateRewrite &&
    portalCatchAllRewrite &&
    adminCatchAllRewrite
  );
};

const hasPrivateNoStoreHeaders = (routes) => {
  const privateShellHeadersIndex = routes.findIndex(
    (route) =>
      route?.src === "/(portal|admin)(.*)" &&
      route?.continue === true &&
      route?.headers?.["Cache-Control"] === "no-store" &&
      route?.headers?.["X-Robots-Tag"] === "noindex, nofollow, noarchive, nosnippet"
  );

  const authShellHeadersIndex = routes.findIndex(
    (route) =>
      route?.src === "/(login(?:/operator)?|reset-password|cart)/?" &&
      route?.continue === true &&
      route?.headers?.["Cache-Control"] === "no-store" &&
      route?.headers?.["X-Robots-Tag"] === "noindex, nofollow, noarchive, nosnippet"
  );
  const authPrivateRewriteIndex = routes.findIndex(
    (route) =>
      route?.src === "/(cart|login(?:/operator)?|reset-password)/?" &&
      route?.dest === "/$1.html"
  );
  const portalCatchAllRewriteIndex = routes.findIndex(
    (route) =>
      route?.src === "/portal(?:/.*)?/?" &&
      route?.dest === "/portal.html"
  );
  const adminCatchAllRewriteIndex = routes.findIndex(
    (route) =>
      route?.src === "/admin(?:/.*)?/?" &&
      route?.dest === "/admin.html"
  );

  return (
    privateShellHeadersIndex >= 0 &&
    privateShellHeadersIndex < portalCatchAllRewriteIndex &&
    privateShellHeadersIndex < adminCatchAllRewriteIndex &&
    authShellHeadersIndex >= 0 &&
    authShellHeadersIndex < authPrivateRewriteIndex
  );
};

const hasImmutableAssetHeadersBeforeFilesystem = (routes) => {
  const filesystemIndex = routes.findIndex((route) => route?.handle === "filesystem");
  const immutableAssetIndex = routes.findIndex(
    (route) =>
      route?.src === "/assets/(.*)" &&
      route?.continue === true &&
      route?.headers?.["Cache-Control"] === "public, max-age=31536000, immutable"
  );

  return immutableAssetIndex >= 0 && filesystemIndex > immutableAssetIndex;
};

const hasMissingAssetFallbackGuard = (routes) => {
  const filesystemIndex = routes.findIndex((route) => route?.handle === "filesystem");
  const assetGuardIndex = routes.findIndex(
    (route) =>
      route?.src === "/assets/(.*)" &&
      route?.status === 404 &&
      route?.headers?.["Cache-Control"] === "no-store" &&
      route?.headers?.["Content-Type"] === "text/plain; charset=utf-8"
  );
  const spaFallbackIndex = routes.findIndex(
    (route) => route?.src === "/(.*)" && route?.dest === "/index.html"
  );

  return (
    filesystemIndex >= 0 &&
    assetGuardIndex > filesystemIndex &&
    spaFallbackIndex > assetGuardIndex
  );
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

  if (!hasStaticPrerenderRewriteRules(routes)) {
    throw new Error("vercel.json is missing static prerender rewrite rules before SPA fallback");
  }

  if (!hasPrivateNoStoreHeaders(routes)) {
    throw new Error("vercel.json must mark app/auth/private shell routes with Cache-Control: no-store");
  }

  if (!hasImmutableAssetHeadersBeforeFilesystem(routes)) {
    throw new Error("vercel.json must mark existing /assets/* files immutable before filesystem serving");
  }

  if (!hasMissingAssetFallbackGuard(routes)) {
    throw new Error(
      "vercel.json must return a 404 for missing /assets/* files before the SPA fallback"
    );
  }
};

const assertDistFileExists = async (manifestPath, context) => {
  const normalizedPath = manifestPath.replace(/^\/+/, "");
  const resolvedPath = path.join(DIST_DIR, normalizedPath);

  try {
    await access(resolvedPath);
  } catch {
    throw new Error(`Vite manifest references missing ${context}: ${normalizedPath}`);
  }
};

const validateViteManifestReferences = async () => {
  const manifestPath = path.join(DIST_DIR, ".vite", "manifest.json");
  const raw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  const visitedEntries = new Set();

  const validateManifestEntry = async (entryKey) => {
    if (visitedEntries.has(entryKey)) {
      return;
    }

    const entry = manifest?.[entryKey];

    if (!entry) {
      throw new Error(`Vite manifest is missing referenced entry: ${entryKey}`);
    }

    visitedEntries.add(entryKey);

    if (entry.file) {
      await assertDistFileExists(entry.file, `${entryKey} file`);
    }

    for (const field of ["css", "assets"]) {
      for (const referencedFile of entry[field] ?? []) {
        await assertDistFileExists(referencedFile, `${entryKey} ${field} asset`);
      }
    }

    for (const field of ["imports", "dynamicImports"]) {
      for (const referencedEntry of entry[field] ?? []) {
        if (!manifest[referencedEntry]) {
          throw new Error(
            `Vite manifest entry ${entryKey} references missing ${field} entry: ${referencedEntry}`
          );
        }

        await validateManifestEntry(referencedEntry);
      }
    }
  };

  await Promise.all(Object.keys(manifest).map((entryKey) => validateManifestEntry(entryKey)));
};

const main = async () => {
  const { vite, seoRoutes } = await loadSeoRoutes();

  try {
    await validateRobots();
    await validateSitemap(seoRoutes);
    await validateVercelConfig();
    await validateViteManifestReferences();

    for (const route of seoRoutes.publicRoutes) {
      await validatePublicRouteHtml(route, seoRoutes);
    }

    for (const route of seoRoutes.privateRoutes) {
      await validatePrivateRouteHtml(route, seoRoutes);
    }

    console.log(
      `SEO regression checks passed: ${seoRoutes.publicRoutes.length} public routes and ${seoRoutes.privateRoutes.length} private routes validated.`
    );
  } finally {
    await vite.close();
  }
};

await main();

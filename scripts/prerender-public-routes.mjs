import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

process.env.VITE_SUPABASE_URL ||= "https://example.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY ||= "prerender-anon-key";

const DIST_DIR = path.resolve(process.cwd(), "dist");
const TEMPLATE_PATH = path.join(DIST_DIR, "index.html");
const MANIFEST_PATH = path.join(DIST_DIR, ".vite", "manifest.json");

const escapeAttribute = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const escapeText = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
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

const upsertStructuredDataScript = (html, data, structuredDataScriptId) => {
  const script = `<script id="${structuredDataScriptId}" type="application/ld+json">${escapeScriptContent(
    JSON.stringify(data)
  )}</script>`;
  const pattern = new RegExp(
    `<script[^>]*id=["']${escapeRegex(structuredDataScriptId)}["'][^>]*>[\\s\\S]*?<\\/script>`,
    "i"
  );

  if (pattern.test(html)) {
    return html.replace(pattern, script);
  }

  return html.replace("</head>", `  ${script}\n  </head>`);
};

const removeStructuredDataScript = (html, structuredDataScriptId) =>
  html.replace(
    new RegExp(
      `<script[^>]*id=["']${escapeRegex(structuredDataScriptId)}["'][^>]*>[\\s\\S]*?<\\/script>\\s*`,
      "i"
    ),
    ""
  );

const upsertTitle = (html, title) =>
  html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeText(title)}</title>`);

const injectRootHtml = (html, appHtml) =>
  html.replace(
    /<div id="root"><\/div>/,
    `<div id="root" data-prerendered="true">${appHtml}</div>`
  );

const normalizeTemplateRoot = (html) =>
  html.replace(
    /<div id="root"[^>]*>[\s\S]*<\/div>\s*(?=<script type="module")/,
    '<div id="root"></div>\n    '
  );

const loadAssetManifest = async () => {
  const raw = await readFile(MANIFEST_PATH, "utf8");
  return JSON.parse(raw);
};

const replaceDevAssetUrls = (html, manifest) =>
  html.replace(/(["'(])\/src\/assets\/([^"')\s]+)/g, (match, prefix, assetPath) => {
    const entry = manifest[`src/assets/${assetPath}`];
    return entry?.file ? `${prefix}/${entry.file}` : match;
  });

const outputFilesForRoute = (pathname) => {
  if (pathname === "/") {
    return [path.join(DIST_DIR, "index.html")];
  }

  const routePath = pathname.replace(/^\//, "");
  return [
    path.join(DIST_DIR, routePath, "index.html"),
    path.join(DIST_DIR, `${routePath}.html`),
  ];
};

const writeRouteHtml = async (pathname, html) => {
  const outputPaths = outputFilesForRoute(pathname);
  await Promise.all(
    outputPaths.map(async (outputPath) => {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, html, "utf8");
    })
  );
};

const withSeoTags = ({
  template,
  route,
  canonicalUrl,
  origin,
  shareImage,
  structuredData,
  constants,
}) => {
  const imageAlt = route.ogImageAlt ?? constants.DEFAULT_IMAGE_ALT;
  let html = template;

  html = upsertTitle(html, route.title);
  html = upsertMetaTag(html, "name", "description", route.description);
  html = upsertMetaTag(html, "name", "robots", route.robots);
  html = upsertMetaTag(html, "name", "theme-color", constants.THEME_COLOR);
  html = upsertMetaTag(html, "property", "og:title", route.title);
  html = upsertMetaTag(html, "property", "og:site_name", constants.WEBSITE_NAME);
  html = upsertMetaTag(html, "property", "og:description", route.description);
  html = upsertMetaTag(html, "property", "og:type", route.ogType ?? "website");
  html = upsertMetaTag(html, "property", "og:url", canonicalUrl);
  html = upsertMetaTag(html, "property", "og:image", shareImage);
  html = upsertMetaTag(html, "property", "og:image:alt", imageAlt);
  html = upsertMetaTag(html, "name", "twitter:card", "summary_large_image");
  html = upsertMetaTag(html, "name", "twitter:title", route.title);
  html = upsertMetaTag(html, "name", "twitter:description", route.description);
  html = upsertMetaTag(html, "name", "twitter:image", shareImage);
  html = upsertMetaTag(html, "name", "twitter:image:alt", imageAlt);
  html = upsertCanonical(html, canonicalUrl);

  if (structuredData) {
    html = upsertStructuredDataScript(
      html,
      structuredData,
      constants.STRUCTURED_DATA_SCRIPT_ID
    );
  } else {
    html = removeStructuredDataScript(html, constants.STRUCTURED_DATA_SCRIPT_ID);
  }

  return html;
};

const buildSitemap = ({ publicRoutes, canonicalForPath, marketingOrigin }) => {
  const routeEntries = publicRoutes
    .map((route) => {
      const loc = canonicalForPath(marketingOrigin, route.path);
      const imageEntries = (route.sitemapImages ?? [])
        .map(
          (image) => `    <image:image>
      <image:loc>${escapeText(image.loc)}</image:loc>
      <image:title>${escapeText(image.title)}</image:title>
    </image:image>`
        )
        .join("\n");

      return `  <url>
    <loc>${escapeText(loc)}</loc>
    <lastmod>${escapeText(route.lastmod)}</lastmod>${imageEntries ? `\n${imageEntries}` : ""}
  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${routeEntries}
</urlset>
`;
};

const loadPrerenderModules = async () => {
  const vite = await createServer({
    appType: "custom",
    logLevel: "error",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  });

  try {
    const seoRoutes = await vite.ssrLoadModule("/src/lib/seoRoutes.ts");
    const prerender = await vite.ssrLoadModule("/src/entry-prerender.tsx");
    return { vite, seoRoutes, prerender };
  } catch (error) {
    await vite.close();
    throw error;
  }
};

const main = async () => {
  const template = normalizeTemplateRoot(await readFile(TEMPLATE_PATH, "utf8"));
  const assetManifest = await loadAssetManifest();
  const { vite, seoRoutes, prerender } = await loadPrerenderModules();

  try {
    const {
      APP_ORIGIN,
      MARKETING_ORIGIN,
      buildStructuredData,
      canonicalForPath,
      getShareImageUrl,
      privateRoutes,
      publicRoutes,
    } = seoRoutes;

    for (const route of publicRoutes) {
      const canonicalUrl = canonicalForPath(MARKETING_ORIGIN, route.path);
      const appHtml = replaceDevAssetUrls(
        await prerender.renderRoute(route.path),
        assetManifest
      );
      const rendered = injectRootHtml(
        withSeoTags({
          template,
          route,
          canonicalUrl,
          origin: MARKETING_ORIGIN,
          shareImage: getShareImageUrl(MARKETING_ORIGIN, route),
          structuredData: buildStructuredData({
            route,
            origin: MARKETING_ORIGIN,
            canonicalUrl,
          }),
          constants: seoRoutes,
        }),
        appHtml
      );
      await writeRouteHtml(route.path, rendered);
    }

    for (const route of privateRoutes) {
      const canonicalOrigin = route.canonicalOrigin ?? APP_ORIGIN;
      const canonicalUrl = canonicalForPath(canonicalOrigin, route.canonicalPath ?? route.path);
      const rendered = withSeoTags({
        template,
        route,
        canonicalUrl,
        origin: canonicalOrigin,
        shareImage: getShareImageUrl(canonicalOrigin, route),
        structuredData: null,
        constants: seoRoutes,
      });
      await writeRouteHtml(route.path, rendered);
    }

    await writeFile(
      path.join(DIST_DIR, "sitemap.xml"),
      buildSitemap({
        publicRoutes,
        canonicalForPath,
        marketingOrigin: MARKETING_ORIGIN,
      }),
      "utf8"
    );

    console.log(
      `Prerendered static HTML for ${publicRoutes.length} public routes and SEO head tags for ${privateRoutes.length} private routes.`
    );
  } finally {
    await vite.close();
  }
};

await main();

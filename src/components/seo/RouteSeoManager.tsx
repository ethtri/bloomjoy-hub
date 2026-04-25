import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { getCanonicalOriginForSurface } from "@/lib/appSurface";
import {
  buildStructuredData,
  getRouteSeo,
  getShareImageUrl,
  PUBLIC_ROBOTS,
  STRUCTURED_DATA_SCRIPT_ID,
  THEME_COLOR,
  WEBSITE_NAME,
} from "@/lib/seoRoutes";

const upsertMetaTag = (
  attribute: "name" | "property",
  key: string,
  content: string
) => {
  let tag = document.head.querySelector(`meta[${attribute}="${key}"]`) as HTMLMetaElement | null;
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attribute, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
};

const upsertCanonicalLink = (href: string) => {
  let link = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    document.head.appendChild(link);
  }
  link.setAttribute("href", href);
};

const upsertStructuredData = (data: Record<string, unknown>) => {
  let script = document.head.querySelector(
    `script#${STRUCTURED_DATA_SCRIPT_ID}[type="application/ld+json"]`
  ) as HTMLScriptElement | null;

  if (!script) {
    script = document.createElement("script");
    script.id = STRUCTURED_DATA_SCRIPT_ID;
    script.type = "application/ld+json";
    document.head.appendChild(script);
  }

  script.textContent = JSON.stringify(data);
};

const removeStructuredData = () => {
  const script = document.head.querySelector(
    `script#${STRUCTURED_DATA_SCRIPT_ID}[type="application/ld+json"]`
  );
  if (script) {
    script.remove();
  }
};

export const RouteSeoManager = () => {
  const location = useLocation();

  useEffect(() => {
    const { pathname } = location;
    const seo = getRouteSeo(pathname);
    const canonicalPath = seo.canonicalPath ?? pathname;
    const canonicalOrigin = getCanonicalOriginForSurface(seo.surface, window.location);
    const canonicalUrl = `${canonicalOrigin}${canonicalPath}`;
    const imageUrl = getShareImageUrl(canonicalOrigin, seo);
    const imageAlt = seo.ogImageAlt ?? WEBSITE_NAME;

    document.title = seo.title;
    upsertMetaTag("name", "description", seo.description);
    upsertMetaTag("name", "robots", seo.robots);
    upsertMetaTag("name", "theme-color", THEME_COLOR);

    upsertMetaTag("property", "og:title", seo.title);
    upsertMetaTag("property", "og:site_name", WEBSITE_NAME);
    upsertMetaTag("property", "og:description", seo.description);
    upsertMetaTag("property", "og:type", seo.ogType ?? "website");
    upsertMetaTag("property", "og:url", canonicalUrl);
    upsertMetaTag("property", "og:image", imageUrl);
    upsertMetaTag("property", "og:image:alt", imageAlt);

    upsertMetaTag("name", "twitter:card", "summary_large_image");
    upsertMetaTag("name", "twitter:title", seo.title);
    upsertMetaTag("name", "twitter:description", seo.description);
    upsertMetaTag("name", "twitter:image", imageUrl);
    upsertMetaTag("name", "twitter:image:alt", imageAlt);
    upsertCanonicalLink(canonicalUrl);

    if (seo.robots === PUBLIC_ROBOTS) {
      upsertStructuredData(
        buildStructuredData({
          route: seo,
          origin: canonicalOrigin,
          canonicalUrl,
        })
      );
    } else {
      removeStructuredData();
    }
  }, [location]);

  return null;
};

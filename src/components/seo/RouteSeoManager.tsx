import { useEffect } from "react";
import { useLocation } from "react-router-dom";

type RouteSeo = {
  title: string;
  description: string;
  robots: string;
  ogType?: "website" | "article";
  canonicalPath?: string;
};

const DEFAULT_DESCRIPTION =
  "Bloomjoy Hub for robotic cotton candy machines, supplies, training, and support.";
const DEFAULT_IMAGE_PATH = "/favicon.svg";
const WEBSITE_NAME = "Bloomjoy Hub";
const ORGANIZATION_NAME = "Bloomjoy";
const STRUCTURED_DATA_SCRIPT_ID = "seo-structured-data";

const PUBLIC_ROBOTS = "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1";
const PRIVATE_ROBOTS = "noindex,nofollow,noarchive,nosnippet";

const routeSeoRules: Array<{ match: (pathname: string) => boolean; seo: RouteSeo }> = [
  {
    match: (pathname) => pathname === "/",
    seo: {
      title: "Bloomjoy Hub | Robotic Cotton Candy Machines and Supplies",
      description:
        "Explore Bloomjoy robotic cotton candy machines, sugar supplies, and optional Plus support for operators.",
      robots: PUBLIC_ROBOTS,
      ogType: "website",
    },
  },
  {
    match: (pathname) => pathname === "/machines",
    seo: {
      title: "Machines | Bloomjoy Hub",
      description:
        "Compare Bloomjoy machine options and find the right cotton candy setup for your venue.",
      robots: PUBLIC_ROBOTS,
    },
  },
  {
    match: (pathname) => pathname === "/machines/commercial-robotic-machine",
    seo: {
      title: "Commercial Robotic Machine | Bloomjoy Hub",
      description:
        "Review the Bloomjoy commercial robotic cotton candy machine, specs, operating footprint, and quote flow.",
      robots: PUBLIC_ROBOTS,
    },
  },
  {
    match: (pathname) => pathname === "/machines/mini",
    seo: {
      title: "Mini Machine | Bloomjoy Hub",
      description:
        "Learn about Bloomjoy Mini and join the waitlist for upcoming availability and launch updates.",
      robots: PUBLIC_ROBOTS,
    },
  },
  {
    match: (pathname) => pathname === "/machines/micro",
    seo: {
      title: "Micro Machine | Bloomjoy Hub",
      description:
        "Explore Bloomjoy Micro machine details, features, and setup fit for compact locations.",
      robots: PUBLIC_ROBOTS,
    },
  },
  {
    match: (pathname) => pathname === "/supplies",
    seo: {
      title: "Supplies | Bloomjoy Hub",
      description:
        "Order Bloomjoy cotton candy sugar and supplies with high-volume-friendly quantity controls.",
      robots: PUBLIC_ROBOTS,
    },
  },
  {
    match: (pathname) => pathname === "/plus",
    seo: {
      title: "Bloomjoy Plus | Membership",
      description:
        "View Bloomjoy Plus membership benefits, support boundaries, and per-machine monthly pricing.",
      robots: PUBLIC_ROBOTS,
    },
  },
  {
    match: (pathname) => pathname === "/resources",
    seo: {
      title: "Resources and FAQs | Bloomjoy Hub",
      description:
        "Get quick answers on training, support boundaries, and how Bloomjoy operations work.",
      robots: PUBLIC_ROBOTS,
    },
  },
  {
    match: (pathname) => pathname === "/contact",
    seo: {
      title: "Contact and Quote Requests | Bloomjoy Hub",
      description:
        "Contact Bloomjoy for machine quotes, demo requests, procurement questions, and general support.",
      robots: PUBLIC_ROBOTS,
    },
  },
  {
    match: (pathname) => pathname === "/about",
    seo: {
      title: "About Bloomjoy | Operator-Focused Support",
      description:
        "Meet Bloomjoy and our operator-focused approach to machines, training, and field support.",
      robots: PUBLIC_ROBOTS,
    },
  },
  {
    match: (pathname) => pathname === "/privacy",
    seo: {
      title: "Privacy Policy | Bloomjoy Hub",
      description: DEFAULT_DESCRIPTION,
      robots: PUBLIC_ROBOTS,
      ogType: "article",
    },
  },
  {
    match: (pathname) => pathname === "/terms",
    seo: {
      title: "Terms of Service | Bloomjoy Hub",
      description: DEFAULT_DESCRIPTION,
      robots: PUBLIC_ROBOTS,
      ogType: "article",
    },
  },
  {
    match: (pathname) => pathname === "/billing-cancellation",
    seo: {
      title: "Billing and Cancellation | Bloomjoy Hub",
      description:
        "Understand billing cadence, cancellations, and account management for Bloomjoy services.",
      robots: PUBLIC_ROBOTS,
      ogType: "article",
    },
  },
  {
    match: (pathname) => pathname === "/login/operator",
    seo: {
      title: "Operator Login | Bloomjoy Hub",
      description:
        "Operator portal access for Bloomjoy training, onboarding, support, and orders.",
      robots: PRIVATE_ROBOTS,
      ogType: "website",
    },
  },
  {
    match: (pathname) =>
      pathname === "/login" ||
      pathname.startsWith("/login/") ||
      pathname === "/reset-password" ||
      pathname === "/cart" ||
      pathname.startsWith("/portal") ||
      pathname.startsWith("/admin"),
    seo: {
      title: "Bloomjoy Hub",
      description: DEFAULT_DESCRIPTION,
      robots: PRIVATE_ROBOTS,
      ogType: "website",
    },
  },
];

const getRouteSeo = (pathname: string): RouteSeo => {
  const matched = routeSeoRules.find((rule) => rule.match(pathname));
  if (matched) {
    return matched.seo;
  }

  return {
    title: "Page Not Found | Bloomjoy Hub",
    description: DEFAULT_DESCRIPTION,
    robots: PRIVATE_ROBOTS,
    ogType: "website",
  };
};

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

const buildStructuredData = ({
  origin,
  canonicalUrl,
  title,
  description,
}: {
  origin: string;
  canonicalUrl: string;
  title: string;
  description: string;
}) => ({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${origin}/#organization`,
      name: ORGANIZATION_NAME,
      url: `${origin}/`,
      logo: `${origin}${DEFAULT_IMAGE_PATH}`,
    },
    {
      "@type": "WebSite",
      "@id": `${origin}/#website`,
      name: WEBSITE_NAME,
      url: `${origin}/`,
      publisher: {
        "@id": `${origin}/#organization`,
      },
    },
    {
      "@type": "WebPage",
      "@id": `${canonicalUrl}#webpage`,
      url: canonicalUrl,
      name: title,
      description,
      isPartOf: {
        "@id": `${origin}/#website`,
      },
      about: {
        "@id": `${origin}/#organization`,
      },
    },
  ],
});

export const RouteSeoManager = () => {
  const location = useLocation();

  useEffect(() => {
    const { pathname } = location;
    const seo = getRouteSeo(pathname);
    const canonicalPath = seo.canonicalPath ?? pathname;
    const canonicalUrl = `${window.location.origin}${canonicalPath}`;
    const imageUrl = `${window.location.origin}${DEFAULT_IMAGE_PATH}`;

    document.title = seo.title;
    upsertMetaTag("name", "description", seo.description);
    upsertMetaTag("name", "robots", seo.robots);

    upsertMetaTag("property", "og:title", seo.title);
    upsertMetaTag("property", "og:description", seo.description);
    upsertMetaTag("property", "og:type", seo.ogType ?? "website");
    upsertMetaTag("property", "og:url", canonicalUrl);
    upsertMetaTag("property", "og:image", imageUrl);

    upsertMetaTag("name", "twitter:card", "summary_large_image");
    upsertMetaTag("name", "twitter:title", seo.title);
    upsertMetaTag("name", "twitter:description", seo.description);
    upsertMetaTag("name", "twitter:image", imageUrl);
    upsertCanonicalLink(canonicalUrl);

    if (seo.robots === PUBLIC_ROBOTS) {
      upsertStructuredData(
        buildStructuredData({
          origin: window.location.origin,
          canonicalUrl,
          title: seo.title,
          description: seo.description,
        })
      );
    } else {
      removeStructuredData();
    }
  }, [location]);

  return null;
};

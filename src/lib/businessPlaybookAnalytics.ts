import {
  businessPlaybookArticles,
  type PlaybookCategoryId,
} from "@/data/businessPlaybook";
import { trackEvent } from "@/lib/analytics";

type PlaybookSurface =
  | "resources_hero"
  | "resources_featured_article"
  | "resources_category"
  | "resources_plus_preview"
  | "playbook_index_hero"
  | "playbook_index_featured"
  | "playbook_index_category"
  | "playbook_index_article_list"
  | "playbook_article_sidebar"
  | "playbook_article_related"
  | "machine_listing"
  | "commercial_machine_page"
  | "mini_machine_page"
  | "micro_machine_page"
  | "contact_success"
  | "plus_page";

type PlaybookClickProps = {
  surface: PlaybookSurface;
  cta: string;
  href: string;
  slug?: string;
  category?: PlaybookCategoryId;
  machine?: string;
  destination_type?: string;
};

const playbookArticlePrefix = "/resources/business-playbook/";

const stripQueryAndHash = (href: string) => href.split("?")[0]?.split("#")[0] ?? href;

const getDestinationType = (href: string) => {
  if (href === "/resources/business-playbook" || href.startsWith("/resources/business-playbook#")) {
    return "playbook_index";
  }

  if (href.startsWith(playbookArticlePrefix)) {
    return "playbook_article";
  }

  if (href.startsWith("/contact")) {
    return "contact";
  }

  if (href.startsWith("/machines")) {
    return "machines";
  }

  if (href.startsWith("/plus")) {
    return "plus";
  }

  if (href.includes("/login")) {
    return "operator_login";
  }

  return href.startsWith("/") ? "internal" : "external";
};

export const getPlaybookArticleSlugFromHref = (href: string) => {
  const path = stripQueryAndHash(href);

  if (!path.startsWith(playbookArticlePrefix)) {
    return undefined;
  }

  return path.replace(playbookArticlePrefix, "") || undefined;
};

export const getPlaybookArticleTrackingProps = (href: string) => {
  const slug = getPlaybookArticleSlugFromHref(href);
  const article = slug
    ? businessPlaybookArticles.find((candidate) => candidate.slug === slug)
    : undefined;

  return {
    slug,
    category: article?.category,
    destination_type: getDestinationType(href),
  };
};

const withDestinationMetadata = (props: PlaybookClickProps) => ({
  ...getPlaybookArticleTrackingProps(props.href),
  ...props,
  destination_type: props.destination_type ?? getDestinationType(props.href),
});

export const trackBusinessPlaybookCtaClick = (props: PlaybookClickProps) => {
  trackEvent("click_business_playbook_cta", withDestinationMetadata(props));
};

export const trackResourcesPlaybookCardClick = (props: PlaybookClickProps) => {
  trackEvent("click_resources_playbook_card", withDestinationMetadata(props));
};

export const trackPlusPreviewResourceClick = (props: PlaybookClickProps) => {
  trackEvent("click_plus_preview_resource", withDestinationMetadata(props));
};

export const trackBuyerFlowPlaybookLinkClick = (props: PlaybookClickProps) => {
  trackEvent("click_buyer_flow_playbook_link", withDestinationMetadata(props));
};

export const trackContactSubmitFromPlaybook = ({
  sourcePage,
  inquiryType,
  machineInterest,
}: {
  sourcePage: string;
  inquiryType: string;
  machineInterest?: string;
}) => {
  const { slug, category } = getPlaybookArticleTrackingProps(sourcePage);

  trackEvent("submit_contact_from_playbook", {
    source_page: sourcePage,
    slug,
    category,
    inquiry_type: inquiryType,
    machine_interest: machineInterest,
  });
};

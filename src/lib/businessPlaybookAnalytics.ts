import {
  businessPlaybookArticles,
  type PlaybookCategoryId,
} from "@/data/businessPlaybook";
import { plannerPath, type PlannerMachineId } from "@/data/businessPlaybookPlanner";
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
  | "playbook_article_inline"
  | "playbook_article_sidebar"
  | "playbook_article_related"
  | "playbook_planner"
  | "resources_planner_promo"
  | "playbook_index_planner_promo"
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
const marketingOrigin = "https://www.bloomjoyusa.com";

const stripQueryAndHash = (href: string) => href.split("?")[0]?.split("#")[0] ?? href;

const getSafeInternalPath = (href?: string | null) => {
  const trimmed = href?.trim();

  if (!trimmed || trimmed.startsWith("//")) {
    return undefined;
  }

  try {
    const url = new URL(trimmed, marketingOrigin);
    const isAbsoluteHttpUrl = /^https?:\/\//i.test(trimmed);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }

    if (isAbsoluteHttpUrl && url.origin !== marketingOrigin) {
      return undefined;
    }

    return url.pathname;
  } catch {
    return trimmed.startsWith("/") ? stripQueryAndHash(trimmed) : undefined;
  }
};

export const getNormalizedInternalSourcePage = (sourcePage?: string | null) =>
  getSafeInternalPath(sourcePage);

const getDestinationType = (href: string) => {
  if (href === plannerPath) {
    return "playbook_planner";
  }

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
  const path = getSafeInternalPath(href) ?? stripQueryAndHash(href);

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

export const getNormalizedBusinessPlaybookSourcePage = (sourcePage?: string | null) => {
  const path = getSafeInternalPath(sourcePage);

  if (path === "/resources/business-playbook" || path === plannerPath) {
    return path;
  }

  const slug = path ? getPlaybookArticleSlugFromHref(path) : undefined;
  const article = slug
    ? businessPlaybookArticles.find((candidate) => candidate.slug === slug)
    : undefined;

  return article ? `${playbookArticlePrefix}${article.slug}` : undefined;
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

export const trackBusinessPlaybookPlannerInteraction = (props: {
  action: "view" | "select_fit_answer" | "select_budget_machine";
  question?: string;
  answer?: string;
  recommendedMachine?: PlannerMachineId | "undecided";
  budgetMachine?: PlannerMachineId | "not_selected";
}) => {
  const eventName =
    props.action === "view"
      ? "view_business_playbook_planner"
      : "update_business_playbook_planner";

  trackEvent(eventName, {
    action: props.action,
    question: props.question,
    answer: props.answer,
    recommended_machine: props.recommendedMachine ?? "undecided",
    budget_machine: props.budgetMachine ?? "not_selected",
  });
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
  const normalizedSourcePage = getNormalizedBusinessPlaybookSourcePage(sourcePage);

  if (!normalizedSourcePage) {
    return;
  }

  const { slug, category } = getPlaybookArticleTrackingProps(normalizedSourcePage);

  trackEvent("submit_contact_from_playbook", {
    source_page: normalizedSourcePage,
    slug,
    category,
    inquiry_type: inquiryType,
    machine_interest: machineInterest,
  });
};

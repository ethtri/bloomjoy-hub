import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  CalendarCheck2,
  ClipboardCheck,
  FileCheck2,
  FileText,
  Lock,
  LogIn,
  MapPinned,
  MessageSquareText,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  businessPlaybookPlusTools,
  plusOperatorExtras,
  type BusinessPlaybookPlusTool,
  type PlusOperatorExtra,
} from "@/data/businessPlaybookPlusTools";
import { trackPlusPreviewResourceClick } from "@/lib/businessPlaybookAnalytics";

type PlusToolsPreviewProps = {
  surface: "resources_plus_preview" | "plus_page";
  introLabel?: string;
  heading?: string;
  description?: string;
  showCtas?: boolean;
  operatorLoginUrl?: string;
};

const toolIcons: Record<BusinessPlaybookPlusTool["icon"], typeof ClipboardCheck> = {
  budget: ClipboardCheck,
  pitch: MessageSquareText,
  launch: CalendarCheck2,
  dailyOps: FileCheck2,
  venue: MapPinned,
};

const extraIcons: Record<PlusOperatorExtra["icon"], typeof ClipboardCheck> = {
  reporting: BarChart3,
  maintenance: Wrench,
  certificate: FileText,
};

export function PlusToolsPreview({
  surface,
  introLabel = "Bloomjoy Plus Preview",
  heading = "Plus-ready worksheet previews for serious operators",
  description = "Public playbooks help you plan. Plus adds the operator layer: worksheet previews, daily job aids, maintenance references, connected reporting where enabled, and the Operator Essentials path.",
  showCtas = true,
  operatorLoginUrl,
}: PlusToolsPreviewProps) {
  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-col gap-3 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
          {introLabel}
        </p>
        <h2 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
          {heading}
        </h2>
        <p className="mx-auto max-w-3xl text-muted-foreground">{description}</p>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {businessPlaybookPlusTools.map((tool) => {
          const Icon = toolIcons[tool.icon];

          return (
            <article
              key={tool.id}
              className="flex h-full flex-col rounded-xl border border-border bg-background p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tool.accentClass}`}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <Lock className="h-3 w-3" />
                  {tool.formatLabel}
                </span>
              </div>

              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                  {tool.categoryLabel}
                </p>
                <h3 className="mt-2 font-display text-lg font-bold leading-tight text-foreground">
                  {tool.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {tool.description}
                </p>
              </div>

              <div className="mt-4 rounded-lg bg-muted/25 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Preview includes
                </p>
                <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                  {tool.previewItems.map((item) => (
                    <li key={item} className="flex gap-2">
                      <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 rounded-md border border-border bg-background/70 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                    Sample
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {tool.samplePreview}
                  </p>
                </div>
              </div>

              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">Best for:</span> {tool.bestFor}
              </p>

              <Link
                to={tool.articleHref}
                onClick={() =>
                  trackPlusPreviewResourceClick({
                    surface,
                    cta: `${tool.id}_related_guide`,
                    href: tool.articleHref,
                  })
                }
                className="mt-auto inline-flex items-center gap-2 pt-5 text-sm font-semibold text-primary hover:underline"
              >
                {tool.articleLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </article>
          );
        })}
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {plusOperatorExtras.map((extra) => {
          const Icon = extraIcons[extra.icon];

          return (
            <div
              key={extra.title}
              className="flex gap-3 rounded-lg border border-border bg-background/70 p-4"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <div>
                <h3 className="font-display text-base font-semibold text-foreground">
                  {extra.title}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {extra.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {showCtas && (
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link
              to="/plus"
              onClick={() =>
                trackPlusPreviewResourceClick({
                  surface,
                  cta: "explore_bloomjoy_plus",
                  href: "/plus",
                })
              }
            >
              Explore Bloomjoy Plus
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          {operatorLoginUrl && (
            <Button asChild variant="outline">
              <a
                href={operatorLoginUrl}
                onClick={() =>
                  trackPlusPreviewResourceClick({
                    surface,
                    cta: "operator_login",
                    href: operatorLoginUrl,
                  })
                }
              >
                <LogIn className="mr-2 h-4 w-4" />
                Operator Login
              </a>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

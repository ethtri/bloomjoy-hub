import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Calculator,
  CheckCircle2,
  ClipboardList,
  Copy,
  DollarSign,
  Info,
  Printer,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout/Layout";
import {
  trackBusinessPlaybookCtaClick,
  trackBusinessPlaybookPaybackPlannerInteraction,
} from "@/lib/businessPlaybookAnalytics";
import { type PlannerBudget, type PlannerBudgetKey } from "@/data/businessPlaybookPlanner";
import {
  blankPaybackInputs,
  blankStartupCosts,
  paybackPlannerSource,
  paybackPresets,
  paybackPresetDisclaimer,
  paybackScenarioProfiles,
  paybackStartupCostLabels,
  startupCostKeys,
  type CommercialPaybackInputs,
  type EventPaybackInputs,
  type PaybackInputs,
  type PaybackPreset,
  type PaybackScenarioId,
} from "@/data/businessPlaybookPaybackPlanner";
import { cn } from "@/lib/utils";

type Estimate = {
  monthlyUnits: number;
  grossMonthly: number;
  monthlyOperatingCosts: number;
  monthlyRecoveryAmount: number;
  contributionPerServing: number;
  breakEvenOrders: number | null;
  servingsNeeded: number | null;
  baseMonths: number | null;
  stressMonths: number | null;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 10 && value > 0 ? 2 : 0,
  }).format(Number.isFinite(value) ? value : 0);

const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    Number.isFinite(value) ? Math.max(0, value) : 0
  );

const formatMonths = (value: number | null) => {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return "Not available yet";
  }

  if (value < 1) {
    return "Under 1 month";
  }

  if (value > 120) {
    return "More than 10 years at these assumptions";
  }

  const rounded = Math.ceil(value);
  return `${rounded} month${rounded === 1 ? "" : "s"}`;
};

const getSafeNumber = (value: number, max = 1_000_000) => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.min(max, Math.round(value * 100) / 100);
};

const getSafePercent = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.min(100, Math.round(value * 100) / 100);
};

const getStartupCostTotal = (startupCosts: PlannerBudget) =>
  startupCostKeys.reduce((total, key) => total + startupCosts[key], 0);

const getDemandBand = (monthlyUnits: number) => {
  if (monthlyUnits <= 0) return "blank";
  if (monthlyUnits < 100) return "low";
  if (monthlyUnits < 400) return "medium";
  return "high";
};

const getCostBand = (startupCost: number) => {
  if (startupCost <= 0) return "blank";
  if (startupCost < 5_000) return "low";
  if (startupCost < 10_000) return "medium";
  return "high";
};

const estimateCommercialScenario = (
  startupCost: number,
  inputs: CommercialPaybackInputs
): Estimate => {
  const demandOrders =
    inputs.dailyFootTraffic *
    inputs.operatingDaysPerMonth *
    (inputs.familyParentPresencePercent / 100) *
    (inputs.impulseCaptureRatePercent / 100);
  const capacityOrders =
    inputs.serviceHoursPerDay *
    inputs.practicalOrdersPerHour *
    inputs.operatingDaysPerMonth;
  const monthlyUnits = Math.floor(
    Math.min(demandOrders, capacityOrders) * Math.max(0, 1 - inputs.downtimePercent / 100)
  );
  const grossMonthly = monthlyUnits * inputs.pricePerServing;
  const paymentFees =
    grossMonthly * (inputs.paymentFeePercent / 100) + monthlyUnits * inputs.paymentFeeFlat;
  const venueShare = grossMonthly * (inputs.revenueSharePercent / 100);
  const variableCosts = monthlyUnits * inputs.variableCostPerServing;
  const laborCost = inputs.monthlyLaborHours * inputs.hourlyLaborCost;
  const monthlyOperatingCosts =
    variableCosts +
    paymentFees +
    venueShare +
    inputs.monthlyRent +
    laborCost +
    inputs.fixedMonthlyCosts +
    inputs.serviceRestockCosts;
  const monthlyRecoveryAmount = grossMonthly - monthlyOperatingCosts;
  const contributionPerServing =
    inputs.pricePerServing -
    inputs.variableCostPerServing -
    inputs.pricePerServing * (inputs.paymentFeePercent / 100) -
    inputs.paymentFeeFlat -
    inputs.pricePerServing * (inputs.revenueSharePercent / 100);
  const breakEvenOrders =
    contributionPerServing > 0
      ? Math.ceil(
          (inputs.monthlyRent +
            laborCost +
            inputs.fixedMonthlyCosts +
            inputs.serviceRestockCosts) /
            contributionPerServing
        )
      : null;
  const servingsNeeded =
    startupCost > 0 && contributionPerServing > 0
      ? startupCost / contributionPerServing
      : null;
  const baseMonths =
    startupCost > 0 && monthlyRecoveryAmount > 0
      ? startupCost / monthlyRecoveryAmount
      : null;

  const stressMonthlyUnits = monthlyUnits * 0.75;
  const stressGrossMonthly = stressMonthlyUnits * inputs.pricePerServing;
  const stressPaymentFees =
    stressGrossMonthly * (inputs.paymentFeePercent / 100) +
    stressMonthlyUnits * inputs.paymentFeeFlat;
  const stressVenueShare = stressGrossMonthly * (inputs.revenueSharePercent / 100);
  const stressVariableCosts = stressMonthlyUnits * inputs.variableCostPerServing;
  const stressRecovery =
    stressGrossMonthly -
    (stressVariableCosts +
      stressPaymentFees +
      stressVenueShare +
      inputs.monthlyRent +
      laborCost +
      inputs.fixedMonthlyCosts +
      inputs.serviceRestockCosts);
  const stressMonths =
    startupCost > 0 && stressRecovery > 0 ? (startupCost * 1.15) / stressRecovery : null;

  return {
    monthlyUnits,
    grossMonthly,
    monthlyOperatingCosts,
    monthlyRecoveryAmount,
    contributionPerServing,
    breakEvenOrders,
    servingsNeeded,
    baseMonths,
    stressMonths,
  };
};

const estimateEventScenario = (
  startupCost: number,
  inputs: EventPaybackInputs
): Estimate => {
  const pressureMultiplier = Math.max(0, 1 - inputs.competingTreatsPressurePercent / 100);
  const demandOrders =
    inputs.eventsPerMonth *
    inputs.averageEventAttendance *
    (inputs.guestFitPercent / 100) *
    (inputs.eventCaptureRatePercent / 100) *
    pressureMultiplier;
  const capacityOrders =
    inputs.eventsPerMonth * inputs.serviceHoursPerEvent * inputs.practicalOrdersPerHour;
  const monthlyUnits = Math.floor(
    Math.min(demandOrders, capacityOrders) * Math.max(0, 1 - inputs.downtimePercent / 100)
  );
  const grossMonthly = monthlyUnits * inputs.pricePerServing;
  const paymentFees =
    grossMonthly * (inputs.paymentFeePercent / 100) + monthlyUnits * inputs.paymentFeeFlat;
  const variableCosts = monthlyUnits * inputs.variableCostPerServing;
  const eventCosts =
    inputs.eventsPerMonth * (inputs.eventCostsPerEvent + inputs.staffingTravelPerEvent);
  const monthlyOperatingCosts =
    variableCosts + paymentFees + eventCosts + inputs.fixedMonthlyCosts;
  const monthlyRecoveryAmount = grossMonthly - monthlyOperatingCosts;
  const contributionPerServing =
    inputs.pricePerServing -
    inputs.variableCostPerServing -
    inputs.pricePerServing * (inputs.paymentFeePercent / 100) -
    inputs.paymentFeeFlat;
  const breakEvenOrders =
    contributionPerServing > 0
      ? Math.ceil((eventCosts + inputs.fixedMonthlyCosts) / contributionPerServing)
      : null;
  const servingsNeeded =
    startupCost > 0 && contributionPerServing > 0
      ? startupCost / contributionPerServing
      : null;
  const baseMonths =
    startupCost > 0 && monthlyRecoveryAmount > 0
      ? startupCost / monthlyRecoveryAmount
      : null;

  const stressMonthlyUnits = monthlyUnits * 0.75;
  const stressGrossMonthly = stressMonthlyUnits * inputs.pricePerServing;
  const stressPaymentFees =
    stressGrossMonthly * (inputs.paymentFeePercent / 100) +
    stressMonthlyUnits * inputs.paymentFeeFlat;
  const stressVariableCosts = stressMonthlyUnits * inputs.variableCostPerServing;
  const stressRecovery =
    stressGrossMonthly -
    (stressVariableCosts + stressPaymentFees + eventCosts + inputs.fixedMonthlyCosts);
  const stressMonths =
    startupCost > 0 && stressRecovery > 0 ? (startupCost * 1.15) / stressRecovery : null;

  return {
    monthlyUnits,
    grossMonthly,
    monthlyOperatingCosts,
    monthlyRecoveryAmount,
    contributionPerServing,
    breakEvenOrders,
    servingsNeeded,
    baseMonths,
    stressMonths,
  };
};

const getEstimate = (
  scenario: PaybackScenarioId | null,
  startupCosts: PlannerBudget,
  inputs: PaybackInputs
) => {
  const startupCost = getStartupCostTotal(startupCosts);

  if (!scenario) {
    return undefined;
  }

  return scenario === "commercial"
    ? estimateCommercialScenario(startupCost, inputs.commercial)
    : estimateEventScenario(startupCost, inputs.event);
};

const getQuoteHref = (scenario: PaybackScenarioId | null) => {
  const interest = scenario ? paybackScenarioProfiles[scenario].contactInterest : undefined;
  return interest
    ? `/contact?type=quote&interest=${interest}&source=${paybackPlannerSource}`
    : `/contact?type=quote&source=${paybackPlannerSource}`;
};

const getSummaryText = ({
  scenario,
  startupCosts,
  inputs,
  estimate,
  selectedPreset,
}: {
  scenario: PaybackScenarioId | null;
  startupCosts: PlannerBudget;
  inputs: PaybackInputs;
  estimate?: Estimate;
  selectedPreset?: PaybackPreset;
}) => {
  const profile = scenario ? paybackScenarioProfiles[scenario] : undefined;
  const startupTotal = getStartupCostTotal(startupCosts);
  const activeInputs = scenario === "commercial" ? inputs.commercial : inputs.event;
  const assumptionRows =
    scenario === "commercial"
      ? [
          `- Daily foot traffic estimate: ${inputs.commercial.dailyFootTraffic}`,
          `- Family/parent presence: ${inputs.commercial.familyParentPresencePercent}%`,
          `- Impulse capture rate: ${inputs.commercial.impulseCaptureRatePercent}%`,
          `- Planned service days/month: ${inputs.commercial.operatingDaysPerMonth}`,
          `- Practical capacity: ${inputs.commercial.serviceHoursPerDay} hours/day at ${inputs.commercial.practicalOrdersPerHour} orders/hour`,
          `- Downtime/service gap: ${inputs.commercial.downtimePercent}%`,
          `- Monthly rent: ${formatCurrency(inputs.commercial.monthlyRent)}`,
          `- Revenue share: ${inputs.commercial.revenueSharePercent}%`,
          `- Monthly labor: ${inputs.commercial.monthlyLaborHours} hours at ${formatCurrency(inputs.commercial.hourlyLaborCost)}/hour`,
        ]
      : [
          `- Planned events/month: ${inputs.event.eventsPerMonth}`,
          `- Average event attendance: ${inputs.event.averageEventAttendance}`,
          `- Buyer/guest fit: ${inputs.event.guestFitPercent}%`,
          `- Event capture rate: ${inputs.event.eventCaptureRatePercent}%`,
          `- Competing sweet-treat pressure: ${inputs.event.competingTreatsPressurePercent}%`,
          `- Practical capacity: ${inputs.event.serviceHoursPerEvent} hours/event at ${inputs.event.practicalOrdersPerHour} orders/hour`,
          `- Downtime/service gap: ${inputs.event.downtimePercent}%`,
          `- Event + staffing/travel costs per event: ${formatCurrency(
            inputs.event.eventCostsPerEvent + inputs.event.staffingTravelPerEvent
          )}`,
        ];

  return [
    "Bloomjoy Payback Scenario Planner notes",
    "",
    `Scenario: ${profile?.label ?? "Not selected"}`,
    selectedPreset
      ? `Sample preset used: ${selectedPreset.title}. ${paybackPresetDisclaimer}`
      : "Sample preset used: none",
    `Estimated startup cost to recover: ${formatCurrency(startupTotal)}`,
    `Price per serving: ${formatCurrency(activeInputs.pricePerServing)}`,
    `Variable cost per serving: ${formatCurrency(activeInputs.variableCostPerServing)}`,
    `Payment fee assumption: ${activeInputs.paymentFeePercent}%`,
    ...assumptionRows,
    "",
    "Scenario output:",
    `- Contribution per serving before fixed costs: ${formatCurrency(
      estimate?.contributionPerServing ?? 0
    )}`,
    `- Monthly orders modeled from demand and capacity: ${formatNumber(
      estimate?.monthlyUnits ?? 0
    )}`,
    `- Monthly break-even orders before startup recovery: ${
      estimate?.breakEvenOrders !== null && estimate?.breakEvenOrders !== undefined
        ? formatNumber(estimate.breakEvenOrders)
        : "Not available yet"
    }`,
    `- Monthly amount available for startup-cost recovery: ${formatCurrency(
      estimate?.monthlyRecoveryAmount ?? 0
    )}`,
    `- Servings needed to recover startup costs: ${
      estimate?.servingsNeeded !== null && estimate?.servingsNeeded !== undefined
        ? formatNumber(estimate.servingsNeeded)
        : "Not available yet"
    }`,
    `- Scenario recovery range: ${formatMonths(estimate?.baseMonths ?? null)} base / ${formatMonths(
      estimate?.stressMonths ?? null
    )} stress check`,
    "",
    "Assumptions to verify:",
    "- Final machine quote or list price and configuration",
    "- Freight, tariffs, duties, brokerage, shipping, delivery, and setup terms",
    "- Actual venue/event demand, family presence, service window, and competing treat options",
    "- Rent, revenue share, reporting cadence, review date, and exit terms",
    "- Local legal, tax, insurance, permit, and accounting requirements",
    "",
    "This is planning math only, not a promise of revenue, ROI, profit, location performance, or payback.",
  ].join("\n");
};

const NumberField = ({
  id,
  label,
  value,
  helper,
  prefix,
  suffix,
  step = 1,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  helper?: string;
  prefix?: string;
  suffix?: string;
  step?: number;
  max?: number;
  onChange: (value: number) => void;
}) => (
  <label htmlFor={id} className="grid gap-2 rounded-lg border border-border bg-background p-4">
    <span className="font-semibold text-foreground">{label}</span>
    {helper && <span className="text-sm leading-relaxed text-muted-foreground">{helper}</span>}
    <span className="relative mt-1">
      {prefix && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
          {prefix}
        </span>
      )}
      <input
        id={id}
        type="number"
        min="0"
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className={cn(
          "w-full rounded-lg border border-input bg-background py-2 text-sm font-semibold text-foreground",
          prefix ? "pl-8 pr-3" : "px-3",
          suffix ? "pr-10" : ""
        )}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
          {suffix}
        </span>
      )}
    </span>
  </label>
);

const ResultCard = ({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) => (
  <div className="rounded-lg border border-border bg-background p-4 shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      {label}
    </p>
    <p className="mt-2 font-display text-2xl font-bold text-foreground">{value}</p>
    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{helper}</p>
  </div>
);

export default function BusinessPlaybookPaybackPlannerPage() {
  const [scenario, setScenario] = useState<PaybackScenarioId | null>(null);
  const [startupCosts, setStartupCosts] = useState<PlannerBudget>(blankStartupCosts);
  const [inputs, setInputs] = useState<PaybackInputs>(blankPaybackInputs);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");

  const startupCostTotal = useMemo(() => getStartupCostTotal(startupCosts), [startupCosts]);
  const estimate = useMemo(
    () => getEstimate(scenario, startupCosts, inputs),
    [inputs, scenario, startupCosts]
  );
  const selectedPreset = selectedPresetId
    ? paybackPresets.find((preset) => preset.id === selectedPresetId)
    : undefined;
  const quoteHref = getQuoteHref(scenario);
  const activeProfile = scenario ? paybackScenarioProfiles[scenario] : undefined;
  const activeInputs = scenario === "commercial" ? inputs.commercial : inputs.event;
  const summaryText = getSummaryText({
    scenario,
    startupCosts,
    inputs,
    estimate,
    selectedPreset,
  });

  useEffect(() => {
    trackBusinessPlaybookPaybackPlannerInteraction({
      action: "view",
      scenarioType: "not_selected",
      demandBand: "blank",
      costBand: "blank",
    });
  }, []);

  const trackScenarioUpdate = ({
    action,
    nextScenario = scenario,
    nextStartupCosts = startupCosts,
    nextInputs = inputs,
    nextEstimate = estimate,
    presetId,
  }: {
    action: "select_scenario" | "apply_preset" | "update_input" | "copy_summary" | "print_summary";
    nextScenario?: PaybackScenarioId | null;
    nextStartupCosts?: PlannerBudget;
    nextInputs?: PaybackInputs;
    nextEstimate?: Estimate;
    presetId?: string;
  }) => {
    trackBusinessPlaybookPaybackPlannerInteraction({
      action,
      scenarioType: nextScenario ?? "not_selected",
      hasRent: nextScenario === "commercial" ? nextInputs.commercial.monthlyRent > 0 : false,
      hasRevenueShare:
        nextScenario === "commercial" ? nextInputs.commercial.revenueSharePercent > 0 : false,
      demandBand: getDemandBand(nextEstimate?.monthlyUnits ?? 0),
      costBand: getCostBand(getStartupCostTotal(nextStartupCosts)),
      presetId,
    });
  };

  const handleScenarioChange = (nextScenario: PaybackScenarioId) => {
    const nextStartupCosts = paybackScenarioProfiles[nextScenario].defaultStartupCosts;
    setScenario(nextScenario);
    setStartupCosts(nextStartupCosts);
    setInputs(blankPaybackInputs);
    setSelectedPresetId(null);
    setCopyStatus("idle");
    trackBusinessPlaybookPaybackPlannerInteraction({
      action: "select_scenario",
      scenarioType: nextScenario,
      hasRent: false,
      hasRevenueShare: false,
      demandBand: "blank",
      costBand: getCostBand(getStartupCostTotal(nextStartupCosts)),
    });
  };

  const handlePreset = (preset: PaybackPreset) => {
    const nextEstimate = getEstimate(preset.scenario, preset.startupCosts, preset.inputs);
    setScenario(preset.scenario);
    setStartupCosts(preset.startupCosts);
    setInputs(preset.inputs);
    setSelectedPresetId(preset.id);
    setCopyStatus("idle");
    trackBusinessPlaybookPaybackPlannerInteraction({
      action: "apply_preset",
      scenarioType: preset.scenario,
      hasRent: preset.inputs.commercial.monthlyRent > 0,
      hasRevenueShare: preset.inputs.commercial.revenueSharePercent > 0,
      demandBand: getDemandBand(nextEstimate?.monthlyUnits ?? 0),
      costBand: getCostBand(getStartupCostTotal(preset.startupCosts)),
      presetId: preset.id,
    });
  };

  const handleStartupCostChange = (key: PlannerBudgetKey, value: number) => {
    const nextStartupCosts = { ...startupCosts, [key]: getSafeNumber(value) };
    const nextEstimate = getEstimate(scenario, nextStartupCosts, inputs);
    setStartupCosts(nextStartupCosts);
    setSelectedPresetId(null);
    setCopyStatus("idle");
    trackScenarioUpdate({
      action: "update_input",
      nextStartupCosts,
      nextEstimate,
    });
  };

  const handleCommercialInputChange = (
    key: keyof CommercialPaybackInputs,
    value: number,
    isPercent = false
  ) => {
    const nextInputs = {
      ...inputs,
      commercial: {
        ...inputs.commercial,
        [key]: isPercent ? getSafePercent(value) : getSafeNumber(value),
      },
    };
    const nextEstimate = getEstimate(scenario, startupCosts, nextInputs);
    setInputs(nextInputs);
    setSelectedPresetId(null);
    setCopyStatus("idle");
    trackScenarioUpdate({
      action: "update_input",
      nextInputs,
      nextEstimate,
    });
  };

  const handleEventInputChange = (
    key: keyof EventPaybackInputs,
    value: number,
    isPercent = false
  ) => {
    const nextInputs = {
      ...inputs,
      event: {
        ...inputs.event,
        [key]: isPercent ? getSafePercent(value) : getSafeNumber(value),
      },
    };
    const nextEstimate = getEstimate(scenario, startupCosts, nextInputs);
    setInputs(nextInputs);
    setSelectedPresetId(null);
    setCopyStatus("idle");
    trackScenarioUpdate({
      action: "update_input",
      nextInputs,
      nextEstimate,
    });
  };

  const handleReset = () => {
    if (scenario) {
      handleScenarioChange(scenario);
    } else {
      setStartupCosts(blankStartupCosts);
      setInputs(blankPaybackInputs);
      setSelectedPresetId(null);
      setCopyStatus("idle");
    }
  };

  const handleCopySummary = async () => {
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopyStatus("copied");
      trackScenarioUpdate({ action: "copy_summary" });
    } catch {
      setCopyStatus("error");
    }
  };

  const handlePrintSummary = () => {
    trackScenarioUpdate({ action: "print_summary" });
    window.print();
  };

  return (
    <Layout>
      <section className="border-b border-border bg-gradient-to-b from-cream to-background py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <Link
            to="/resources/business-playbook"
            className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Business Playbook
          </Link>

          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
                Interactive planning tool
              </p>
              <h1 className="mt-4 max-w-4xl font-display text-4xl font-bold leading-tight text-foreground sm:text-5xl">
                Payback Scenario Planner
              </h1>
              <p className="mt-5 max-w-3xl text-lg leading-relaxed text-muted-foreground">
                Model the sales volume needed to recover startup costs using your own assumptions.
                This is planning math, not a promise of revenue, ROI, profit, location performance,
                or payback.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <a href="#scenario-planner">
                    Start planning
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </a>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link
                    to="/resources/business-playbook/cotton-candy-machine-roi-sales-payback-planning"
                    onClick={() =>
                      trackBusinessPlaybookCtaClick({
                        surface: "payback_planner",
                        cta: "read_roi_payback_guide",
                        href: "/resources/business-playbook/cotton-candy-machine-roi-sales-payback-planning",
                      })
                    }
                  >
                    Read the guide
                  </Link>
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-background p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Info className="h-5 w-5" />
                </span>
                <h2 className="font-display text-xl font-bold text-foreground">
                  What this can and cannot do
                </h2>
              </div>
              <ul className="mt-4 grid gap-3 text-sm text-muted-foreground">
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
                  Helps you test what would need to be true before you buy.
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
                  Includes freight, tariffs, shipping, duties, brokerage, supplies, and venue terms.
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
                  Does not predict earnings or store financial assumptions.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section id="scenario-planner" className="scroll-mt-24 py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_26rem]">
            <div className="space-y-8">
              <div>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Sparkles className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="font-display text-3xl font-bold text-foreground">
                      Choose the path you are modeling
                    </h2>
                    <p className="mt-1 text-muted-foreground">
                      The math changes depending on whether you are placing a machine or staffing
                      events.
                    </p>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  {(Object.keys(paybackScenarioProfiles) as PaybackScenarioId[]).map(
                    (scenarioId) => {
                      const profile = paybackScenarioProfiles[scenarioId];
                      const isSelected = scenario === scenarioId;

                      return (
                        <button
                          key={scenarioId}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => handleScenarioChange(scenarioId)}
                          className={cn(
                            "rounded-xl border p-5 text-left transition-[border-color,box-shadow,background-color]",
                            isSelected
                              ? "border-primary bg-primary/5 shadow-sm"
                              : "border-border bg-background hover:border-primary/50"
                          )}
                        >
                          <span className="font-display text-xl font-bold text-foreground">
                            {profile.label}
                          </span>
                          <span className="mt-3 block text-sm leading-relaxed text-muted-foreground">
                            {profile.description}
                          </span>
                        </button>
                      );
                    }
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
                <div className="flex items-start gap-3">
                  <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div>
                    <p className="font-display text-xl font-bold text-foreground">
                      Fictional sample presets
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      These fill the worksheet with made-up example numbers so you can see how the
                      math works. They are not Bloomjoy operating data, expected sales, or a payback
                      promise.
                    </p>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      {paybackPresets.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => handlePreset(preset)}
                          className={cn(
                            "rounded-lg border bg-background p-4 text-left transition-colors hover:border-primary/60",
                            selectedPresetId === preset.id
                              ? "border-primary"
                              : "border-border"
                          )}
                        >
                          <span className="font-semibold text-foreground">{preset.title}</span>
                          <span className="mt-2 block text-sm leading-relaxed text-muted-foreground">
                            {preset.description}
                          </span>
                          <span className="mt-3 block text-xs font-semibold leading-relaxed text-muted-foreground">
                            {paybackPresetDisclaimer}
                          </span>
                        </button>
                      ))}
                    </div>
                    {selectedPreset && (
                      <p className="mt-4 rounded-lg border border-amber/30 bg-amber/10 p-3 text-sm font-medium leading-relaxed text-foreground">
                        {paybackPresetDisclaimer}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-background p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber/10 text-amber">
                    <DollarSign className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                      Startup costs
                    </p>
                    <h2 className="font-display text-2xl font-bold text-foreground">
                      Estimate the cost you are trying to recover
                    </h2>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  Listing price is not the whole launch cost. Add import fees, tariffs, shipping,
                  duties, brokerage, delivery, supplies, and readiness costs when they apply.
                </p>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  {startupCostKeys.map((key) => {
                    const label = paybackStartupCostLabels[key];
                    const helper =
                      key === "importFreight"
                        ? "Use actual quote terms when known. Ask whether shipping from China, tariffs, duties, customs, brokerage, and delivery are included."
                        : label.helper;

                    return (
                      <NumberField
                        key={key}
                        id={`startup-${key}`}
                        label={label.label}
                        helper={helper}
                        prefix="$"
                        step={50}
                        value={startupCosts[key]}
                        onChange={(value) => handleStartupCostChange(key, value)}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-background p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-sage-light text-sage">
                    <BarChart3 className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                      Sales assumptions
                    </p>
                    <h2 className="font-display text-2xl font-bold text-foreground">
                      Model the operating path
                    </h2>
                  </div>
                </div>

                {!scenario && (
                  <div className="mt-5 rounded-lg border border-dashed border-border bg-muted/20 p-5 text-sm leading-relaxed text-muted-foreground">
                    Choose Commercial, Mini, or Micro above to open the right sales assumption
                    fields.
                  </div>
                )}

                {scenario === "commercial" && (
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <NumberField
                      id="commercial-price-per-serving"
                      label="Planned price per serving"
                      helper="Use the price you plan to test. Do not treat this as market advice."
                      prefix="$"
                      step={0.25}
                      value={inputs.commercial.pricePerServing}
                      onChange={(value) => handleCommercialInputChange("pricePerServing", value)}
                    />
                    <NumberField
                      id="commercial-variable-cost"
                      label="Variable cost per serving"
                      helper="Sugar, stick, packaging, and other sale-based costs."
                      prefix="$"
                      step={0.05}
                      value={inputs.commercial.variableCostPerServing}
                      onChange={(value) =>
                        handleCommercialInputChange("variableCostPerServing", value)
                      }
                    />
                    <NumberField
                      id="commercial-payment-fee"
                      label="Payment fee percentage"
                      helper="Use the card/payment processor percentage you expect."
                      suffix="%"
                      step={0.1}
                      max={100}
                      value={inputs.commercial.paymentFeePercent}
                      onChange={(value) =>
                        handleCommercialInputChange("paymentFeePercent", value, true)
                      }
                    />
                    <NumberField
                      id="commercial-payment-flat"
                      label="Flat payment fee per order"
                      helper="Use this for per-transaction fees, if your processor charges one."
                      prefix="$"
                      step={0.05}
                      value={inputs.commercial.paymentFeeFlat}
                      onChange={(value) => handleCommercialInputChange("paymentFeeFlat", value)}
                    />
                    <NumberField
                      id="commercial-foot-traffic"
                      label="Daily foot traffic estimate"
                      helper="Foot traffic alone is not enough; the next field narrows it to likely family/parent buyers."
                      step={1}
                      value={inputs.commercial.dailyFootTraffic}
                      onChange={(value) =>
                        handleCommercialInputChange("dailyFootTraffic", value)
                      }
                    />
                    <NumberField
                      id="commercial-family-presence"
                      label="Family/parent presence"
                      helper="Estimate the share of traffic that includes parents, caregivers, kids, or treat-ready family groups."
                      suffix="%"
                      step={1}
                      max={100}
                      value={inputs.commercial.familyParentPresencePercent}
                      onChange={(value) =>
                        handleCommercialInputChange("familyParentPresencePercent", value, true)
                      }
                    />
                    <NumberField
                      id="commercial-capture-rate"
                      label="Impulse capture rate"
                      helper="The share of likely family/parent traffic that you are modeling as buyers."
                      suffix="%"
                      step={0.5}
                      max={100}
                      value={inputs.commercial.impulseCaptureRatePercent}
                      onChange={(value) =>
                        handleCommercialInputChange("impulseCaptureRatePercent", value, true)
                      }
                    />
                    <NumberField
                      id="commercial-days"
                      label="Planned service days per month"
                      helper="Use the actual venue schedule, including closures or seasonal hours."
                      step={1}
                      value={inputs.commercial.operatingDaysPerMonth}
                      onChange={(value) =>
                        handleCommercialInputChange("operatingDaysPerMonth", value)
                      }
                    />
                    <NumberField
                      id="commercial-service-hours"
                      label="Service hours per day"
                      helper="Capacity matters. Use the hours when the machine is realistically available and visible."
                      step={0.5}
                      value={inputs.commercial.serviceHoursPerDay}
                      onChange={(value) =>
                        handleCommercialInputChange("serviceHoursPerDay", value)
                      }
                    />
                    <NumberField
                      id="commercial-orders-per-hour"
                      label="Practical orders per hour"
                      helper="Use practical throughput after guest decisions, payment, and machine cycle time."
                      step={1}
                      value={inputs.commercial.practicalOrdersPerHour}
                      onChange={(value) =>
                        handleCommercialInputChange("practicalOrdersPerHour", value)
                      }
                    />
                    <NumberField
                      id="commercial-downtime"
                      label="Downtime or service gap"
                      helper="Use a small reduction for restock windows, maintenance, closures, or operational gaps."
                      suffix="%"
                      step={1}
                      max={100}
                      value={inputs.commercial.downtimePercent}
                      onChange={(value) =>
                        handleCommercialInputChange("downtimePercent", value, true)
                      }
                    />
                    <NumberField
                      id="commercial-rent"
                      label="Monthly rent"
                      helper="Flat rent owed to a venue or landlord, if applicable."
                      prefix="$"
                      step={25}
                      value={inputs.commercial.monthlyRent}
                      onChange={(value) => handleCommercialInputChange("monthlyRent", value)}
                    />
                    <NumberField
                      id="commercial-revenue-share"
                      label="Revenue share"
                      helper="Modeled on gross sales here. Define gross/net treatment in writing."
                      suffix="%"
                      step={0.5}
                      max={100}
                      value={inputs.commercial.revenueSharePercent}
                      onChange={(value) =>
                        handleCommercialInputChange("revenueSharePercent", value, true)
                      }
                    />
                    <NumberField
                      id="commercial-labor-hours"
                      label="Monthly labor hours"
                      helper="Owner time, paid help, route service, restock, cleaning, reporting, or troubleshooting."
                      step={1}
                      value={inputs.commercial.monthlyLaborHours}
                      onChange={(value) =>
                        handleCommercialInputChange("monthlyLaborHours", value)
                      }
                    />
                    <NumberField
                      id="commercial-hourly-labor"
                      label="Hourly labor cost"
                      helper="Use a real hourly cost if someone is paid, or a planning value for owner time."
                      prefix="$"
                      step={1}
                      value={inputs.commercial.hourlyLaborCost}
                      onChange={(value) => handleCommercialInputChange("hourlyLaborCost", value)}
                    />
                    <NumberField
                      id="commercial-fixed-costs"
                      label="Other fixed monthly costs"
                      helper="Insurance, software, storage, financing, or subscriptions."
                      prefix="$"
                      step={25}
                      value={inputs.commercial.fixedMonthlyCosts}
                      onChange={(value) =>
                        handleCommercialInputChange("fixedMonthlyCosts", value)
                      }
                    />
                    <NumberField
                      id="commercial-service-costs"
                      label="Service and restock costs"
                      helper="Travel, restock trips, cleaning time, or other monthly service costs."
                      prefix="$"
                      step={25}
                      value={inputs.commercial.serviceRestockCosts}
                      onChange={(value) =>
                        handleCommercialInputChange("serviceRestockCosts", value)
                      }
                    />
                  </div>
                )}

                {(scenario === "mini" || scenario === "micro") && (
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <NumberField
                      id="event-price-per-serving"
                      label="Planned price per serving"
                      helper="Use your event package math. This is not pricing advice."
                      prefix="$"
                      step={0.25}
                      value={inputs.event.pricePerServing}
                      onChange={(value) => handleEventInputChange("pricePerServing", value)}
                    />
                    <NumberField
                      id="event-variable-cost"
                      label="Variable cost per serving"
                      helper="Sugar, stick, packaging, and other sale-based costs."
                      prefix="$"
                      step={0.05}
                      value={inputs.event.variableCostPerServing}
                      onChange={(value) =>
                        handleEventInputChange("variableCostPerServing", value)
                      }
                    />
                    <NumberField
                      id="event-payment-fee"
                      label="Payment fee percentage"
                      helper="Use your card/payment processor percentage."
                      suffix="%"
                      step={0.1}
                      max={100}
                      value={inputs.event.paymentFeePercent}
                      onChange={(value) =>
                        handleEventInputChange("paymentFeePercent", value, true)
                      }
                    />
                    <NumberField
                      id="event-payment-flat"
                      label="Flat payment fee per order"
                      helper="Use this for per-transaction fees, if your processor charges one."
                      prefix="$"
                      step={0.05}
                      value={inputs.event.paymentFeeFlat}
                      onChange={(value) => handleEventInputChange("paymentFeeFlat", value)}
                    />
                    <NumberField
                      id="event-count"
                      label="Planned events per month"
                      helper="Bookings can be seasonal. Model slow months before you model strong months."
                      step={1}
                      value={inputs.event.eventsPerMonth}
                      onChange={(value) => handleEventInputChange("eventsPerMonth", value)}
                    />
                    <NumberField
                      id="event-attendance"
                      label="Average event attendance"
                      helper="Event size matters, but it still needs a buyer-fit and capture-rate assumption."
                      step={1}
                      value={inputs.event.averageEventAttendance}
                      onChange={(value) => handleEventInputChange("averageEventAttendance", value)}
                    />
                    <NumberField
                      id="event-guest-fit"
                      label="Buyer/guest fit"
                      helper="Estimate the share of attendees who are in the right mood or age group for cotton candy."
                      suffix="%"
                      step={1}
                      max={100}
                      value={inputs.event.guestFitPercent}
                      onChange={(value) =>
                        handleEventInputChange("guestFitPercent", value, true)
                      }
                    />
                    <NumberField
                      id="event-capture-rate"
                      label="Event capture rate"
                      helper="The share of buyer-fit guests you are modeling as servings."
                      suffix="%"
                      step={0.5}
                      max={100}
                      value={inputs.event.eventCaptureRatePercent}
                      onChange={(value) =>
                        handleEventInputChange("eventCaptureRatePercent", value, true)
                      }
                    />
                    <NumberField
                      id="event-service-hours"
                      label="Service hours per event"
                      helper="Use the time when the machine is staffed, visible, and serving."
                      step={0.5}
                      value={inputs.event.serviceHoursPerEvent}
                      onChange={(value) => handleEventInputChange("serviceHoursPerEvent", value)}
                    />
                    <NumberField
                      id="event-orders-per-hour"
                      label="Practical orders per hour"
                      helper="Use practical throughput after menu decisions, line flow, payment, and machine cycle time."
                      step={1}
                      value={inputs.event.practicalOrdersPerHour}
                      onChange={(value) =>
                        handleEventInputChange("practicalOrdersPerHour", value)
                      }
                    />
                    <NumberField
                      id="event-competing-treats"
                      label="Competing sweet-treat pressure"
                      helper="Use this if nearby vendors, dessert tables, or included treats may reduce servings."
                      suffix="%"
                      step={5}
                      max={100}
                      value={inputs.event.competingTreatsPressurePercent}
                      onChange={(value) =>
                        handleEventInputChange("competingTreatsPressurePercent", value, true)
                      }
                    />
                    <NumberField
                      id="event-downtime"
                      label="Downtime or service gap"
                      helper="Use a small reduction for setup delays, restock pauses, weather, or event-day interruptions."
                      suffix="%"
                      step={1}
                      max={100}
                      value={inputs.event.downtimePercent}
                      onChange={(value) =>
                        handleEventInputChange("downtimePercent", value, true)
                      }
                    />
                    <NumberField
                      id="event-costs"
                      label="Event costs per booking"
                      helper="Table kit, cleaning, packaging, signage, parking, or event-specific fees."
                      prefix="$"
                      step={10}
                      value={inputs.event.eventCostsPerEvent}
                      onChange={(value) => handleEventInputChange("eventCostsPerEvent", value)}
                    />
                    <NumberField
                      id="event-staffing"
                      label="Staffing and travel per booking"
                      helper="Paid help, owner time, travel, load-in, setup, and teardown."
                      prefix="$"
                      step={10}
                      value={inputs.event.staffingTravelPerEvent}
                      onChange={(value) => handleEventInputChange("staffingTravelPerEvent", value)}
                    />
                    <NumberField
                      id="event-fixed-costs"
                      label="Other fixed monthly costs"
                      helper="Storage, insurance, subscriptions, financing, or recurring admin costs."
                      prefix="$"
                      step={25}
                      value={inputs.event.fixedMonthlyCosts}
                      onChange={(value) => handleEventInputChange("fixedMonthlyCosts", value)}
                    />
                  </div>
                )}
              </div>
            </div>

            <aside className="space-y-5 xl:sticky xl:top-24 xl:self-start">
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                  Scenario output
                </p>
                <h2 className="mt-2 font-display text-2xl font-bold text-foreground">
                  {scenario ? paybackScenarioProfiles[scenario].label : "Choose a path"}
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {activeProfile
                    ? activeProfile.description
                    : "Select a path and add your own assumptions to see planning math."}
                </p>
                {activeProfile && (
                  <ul className="mt-4 grid gap-2 text-sm text-muted-foreground">
                    {activeProfile.planningNotes.map((note) => (
                      <li key={note} className="flex gap-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
                        {note}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="grid gap-3">
                <ResultCard
                  label="Estimated startup cost to recover"
                  value={formatCurrency(startupCostTotal)}
                  helper="Includes the cost rows you entered above. Replace placeholders with real quotes."
                />
                <ResultCard
                  label="Contribution per serving before fixed costs"
                  value={formatCurrency(estimate?.contributionPerServing ?? 0)}
                  helper="What each serving contributes before monthly rent, event costs, fixed costs, and recovery math."
                />
                <ResultCard
                  label="Monthly amount available for startup-cost recovery"
                  value={formatCurrency(estimate?.monthlyRecoveryAmount ?? 0)}
                  helper="This can go negative when the scenario needs better pricing, lower costs, or more demand."
                />
                <ResultCard
                  label="Monthly orders modeled from demand and capacity"
                  value={formatNumber(estimate?.monthlyUnits ?? 0)}
                  helper="Commercial uses foot traffic, family presence, capacity, and downtime. Events use attendance, guest fit, capacity, competition, and downtime."
                />
                <ResultCard
                  label="Monthly break-even orders before startup recovery"
                  value={
                    estimate?.breakEvenOrders !== null && estimate?.breakEvenOrders !== undefined
                      ? formatNumber(estimate.breakEvenOrders)
                      : "Not available yet"
                  }
                  helper="The monthly orders needed to cover monthly fixed, venue, labor, and event costs before recovering startup costs."
                />
                <ResultCard
                  label="Servings needed to recover startup costs"
                  value={
                    estimate?.servingsNeeded !== null && estimate?.servingsNeeded !== undefined
                      ? formatNumber(estimate.servingsNeeded)
                      : "Not available yet"
                  }
                  helper="A volume check based on contribution per serving, not a payback promise."
                />
                <ResultCard
                  label="Scenario recovery range"
                  value={`${formatMonths(estimate?.baseMonths ?? null)} / ${formatMonths(
                    estimate?.stressMonths ?? null
                  )}`}
                  helper="Base scenario first; stress check second assumes 25% fewer servings and 15% higher startup costs."
                />
              </div>

              <div className="rounded-xl border border-border bg-background p-5 shadow-sm">
                <p className="font-display text-lg font-bold text-foreground">
                  Assumptions to verify
                </p>
                <ul className="mt-4 grid gap-3 text-sm text-muted-foreground">
                  <li>Final quote, listed price, and configuration.</li>
                  <li>Freight, tariffs, duties, shipping, brokerage, delivery, and setup terms.</li>
                  <li>
                    {scenario === "commercial"
                      ? "Foot traffic, family/parent presence, dwell time, placement, rent, and revenue share."
                      : "Event size, service window, staffing, weather, travel, and competing sweet-treat vendors."}
                  </li>
                  <li>Legal, tax, insurance, permit, and accounting requirements.</li>
                </ul>
              </div>

              <div className="rounded-xl border border-border bg-background p-5 shadow-sm">
                <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
                  Want Bloomjoy to see the math you modeled? Copy the summary first, then paste it
                  into the quote message.
                </p>
                <div className="flex flex-col gap-3">
                  <Button
                    asChild
                    className="h-auto min-h-10 w-full whitespace-normal text-center leading-snug"
                  >
                    <Link
                      to={quoteHref}
                      onClick={() =>
                        trackBusinessPlaybookCtaClick({
                          surface: "payback_planner",
                          cta: "request_quote_after_planning",
                          href: quoteHref,
                          machine: activeProfile?.shortLabel,
                        })
                      }
                    >
                      Request a quote after planning
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    className="h-auto min-h-10 w-full whitespace-normal text-center leading-snug"
                  >
                    <Link
                      to={
                        activeProfile?.articleHref ??
                        "/resources/business-playbook/startup-budget-checklist-cotton-candy-machine-business"
                      }
                      onClick={() =>
                        trackBusinessPlaybookCtaClick({
                          surface: "payback_planner",
                          cta: activeProfile?.articleLabel ?? "read_startup_budget_guide",
                          href:
                            activeProfile?.articleHref ??
                            "/resources/business-playbook/startup-budget-checklist-cotton-candy-machine-business",
                          machine: activeProfile?.shortLabel,
                        })
                      }
                    >
                      {activeProfile?.articleLabel ?? "Read startup budget guide"}
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCopySummary}
                    className="h-auto min-h-10 w-full whitespace-normal text-center leading-snug"
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Copy summary
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handlePrintSummary}
                    className="h-auto min-h-10 w-full whitespace-normal text-center leading-snug"
                  >
                    <Printer className="mr-2 h-4 w-4" />
                    Print plan
                  </Button>
                  <Button type="button" variant="ghost" onClick={handleReset}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Reset current path
                  </Button>
                  {copyStatus !== "idle" && (
                    <p className="text-sm text-muted-foreground">
                      {copyStatus === "copied"
                        ? "Copied. You can paste it into notes or a quote email."
                        : "Copy did not work in this browser. Print is still available."}
                    </p>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-muted/20 py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="grid gap-5 md:grid-cols-3">
            <div className="rounded-xl border border-border bg-background p-5">
              <Calculator className="h-6 w-6 text-primary" />
              <h2 className="mt-4 font-display text-xl font-bold text-foreground">
                Read the payback guide
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Learn why average monthly sales claims can be misleading and how to build a
                conservative planning model.
              </p>
              <Link
                to="/resources/business-playbook/cotton-candy-machine-roi-sales-payback-planning"
                className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
              >
                Read ROI/payback guide
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="rounded-xl border border-border bg-background p-5">
              <ClipboardList className="h-6 w-6 text-primary" />
              <h2 className="mt-4 font-display text-xl font-bold text-foreground">
                Negotiate venue terms
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Rent, revenue share, hybrid terms, and pilot reviews can change the math. Put the
                business points in writing.
              </p>
              <Link
                to="/resources/business-playbook/revenue-share-vs-rent-cotton-candy-machine-placement"
                className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
              >
                Read revenue-share guide
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="rounded-xl border border-border bg-background p-5">
              <Info className="h-6 w-6 text-primary" />
              <h2 className="mt-4 font-display text-xl font-bold text-foreground">
                Keep the guardrail visible
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                This planner uses your assumptions. Actual results vary by location, seasonality,
                pricing, uptime, service rhythm, local rules, and execution.
              </p>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}

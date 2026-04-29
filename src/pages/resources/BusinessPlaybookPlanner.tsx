import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  CheckCircle2,
  ClipboardList,
  Copy,
  Lightbulb,
  PiggyBank,
  Printer,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout/Layout";
import {
  trackBusinessPlaybookCtaClick,
  trackBusinessPlaybookPlannerInteraction,
} from "@/lib/businessPlaybookAnalytics";
import {
  plannerBudgetLabels,
  plannerMachineProfiles,
  plannerPath,
  plannerQuestions,
  type PlannerBudget,
  type PlannerBudgetKey,
  type PlannerMachineId,
} from "@/data/businessPlaybookPlanner";
import { cn } from "@/lib/utils";

const budgetKeys: PlannerBudgetKey[] = [
  "machine",
  "importFreight",
  "accessoriesPayment",
  "deliverySetup",
  "openingSupplies",
  "localReadiness",
  "operatingBuffer",
];

type PlannerAnswers = Partial<Record<PlannerQuestionId, string>>;

const minimumAnswersForRecommendation = 2;

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);

const getInitialAnswers = (): PlannerAnswers => ({});

const getMachineScores = (answers: PlannerAnswers) =>
  plannerQuestions
    .reduce(
      (scores, question) => {
        const selectedChoice = question.choices.find(
          (choice) => choice.id === answers[question.id]
        );

        if (!selectedChoice) {
          return scores;
        }

        return {
          commercial: scores.commercial + selectedChoice.weights.commercial,
          mini: scores.mini + selectedChoice.weights.mini,
          micro: scores.micro + selectedChoice.weights.micro,
        };
      },
      { commercial: 0, mini: 0, micro: 0 } as Record<PlannerMachineId, number>
    );

const getSelectedChoice = (
  question: (typeof plannerQuestions)[number],
  answers: PlannerAnswers
) => question.choices.find((choice) => choice.id === answers[question.id]);

const getQuoteHref = (machine: PlannerMachineId) =>
  `/contact?type=quote&interest=${plannerMachineProfiles[machine].contactInterest}&source=${encodeURIComponent(
    plannerPath
  )}`;

const getGeneralQuoteHref = () =>
  `/contact?type=quote&source=${encodeURIComponent(plannerPath)}`;

export default function BusinessPlaybookPlannerPage() {
  const [answers, setAnswers] = useState(getInitialAnswers);
  const [budgetMachine, setBudgetMachine] = useState<PlannerMachineId | null>(null);
  const [budget, setBudget] = useState<PlannerBudget>(
    plannerMachineProfiles.mini.defaultBudget
  );
  const [budgetWasEdited, setBudgetWasEdited] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    trackBusinessPlaybookPlannerInteraction({
      action: "view",
      recommendedMachine: "undecided",
      budgetMachine: "not_selected",
    });
  }, []);

  const scores = useMemo(() => getMachineScores(answers), [answers]);
  const answeredCount = useMemo(
    () => plannerQuestions.filter((question) => answers[question.id]).length,
    [answers]
  );
  const rankedMachines = useMemo(
    () =>
      (Object.entries(scores) as Array<[PlannerMachineId, number]>)
        .sort((a, b) => b[1] - a[1])
        .map(([id, score]) => ({
          ...plannerMachineProfiles[id],
          score,
        })),
    [scores]
  );
  const hasEnoughAnswers = answeredCount >= minimumAnswersForRecommendation;
  const topScore = rankedMachines[0]?.score ?? 0;
  const secondScore = rankedMachines[1]?.score ?? 0;
  const hasClearRecommendation = hasEnoughAnswers && topScore > secondScore;
  const recommendedMachine = hasClearRecommendation ? rankedMachines[0] : undefined;
  const tiedMachines =
    hasEnoughAnswers && !hasClearRecommendation
      ? rankedMachines.filter((machine) => machine.score === topScore && topScore > 0)
      : [];
  const maxScore = Math.max(...rankedMachines.map((machine) => machine.score), 1);
  const budgetTotal = budgetKeys.reduce((sum, key) => sum + budget[key], 0);
  const isCommercialQuoteNeeded = budgetMachine === "commercial" && budget.machine === 0;
  const quoteMachine = budgetMachine ?? recommendedMachine?.id;
  const finalQuoteHref = quoteMachine ? getQuoteHref(quoteMachine) : getGeneralQuoteHref();
  const selectedAnswerRows = useMemo(
    () =>
      plannerQuestions.map((question) => ({
        question: question.label,
        answer: getSelectedChoice(question, answers)?.label ?? "Not answered yet",
      })),
    [answers]
  );
  const budgetSnapshot = !budgetMachine
    ? "No budget scenario selected yet."
    : isCommercialQuoteNeeded
      ? `Commercial: machine and landed-cost quote needed + ${formatCurrency(
          budgetTotal
        )} editable launch-prep placeholders.`
      : `${plannerMachineProfiles[budgetMachine].label}: ${formatCurrency(
          budgetTotal
        )} editable planning total.`;
  const summaryText = [
    "Bloomjoy Business Playbook planner notes",
    "",
    `Fit signal: ${
      recommendedMachine
        ? recommendedMachine.label
        : tiedMachines.length > 0
          ? `Close call between ${tiedMachines
              .map((machine) => machine.shortLabel)
              .join(" and ")}`
          : `Answer at least ${minimumAnswersForRecommendation} questions for a signal`
    }`,
    `Budget snapshot: ${budgetSnapshot}`,
    "",
    "Selected answers:",
    ...selectedAnswerRows.map((row) => `- ${row.question}: ${row.answer}`),
    "",
    "Open questions to clarify:",
    "- Machine quote or final list price",
    "- Freight, tariffs, duties, customs, brokerage, delivery, or transport assumptions",
    "- Card reader/payment hardware, accessories, opening sugar, sticks, and first restock cushion",
    "- Local business, insurance, permit, and venue requirements",
    "- First operating rhythm and support path",
  ].join("\n");

  useEffect(() => {
    if (
      !budgetWasEdited &&
      recommendedMachine &&
      recommendedMachine.id !== budgetMachine
    ) {
      setBudgetMachine(recommendedMachine.id);
      setBudget(plannerMachineProfiles[recommendedMachine.id].defaultBudget);
    }
  }, [budgetMachine, budgetWasEdited, recommendedMachine]);

  const handleAnswerChange = (questionId: string, choiceId: string) => {
    const nextAnswers = { ...answers, [questionId]: choiceId };
    const nextScores = getMachineScores(nextAnswers);
    const nextRankedMachines = (Object.entries(nextScores) as Array<[PlannerMachineId, number]>)
      .sort((a, b) => b[1] - a[1]);
    const nextAnsweredCount = plannerQuestions.filter(
      (question) => nextAnswers[question.id]
    ).length;
    const nextRecommended =
      nextAnsweredCount >= minimumAnswersForRecommendation &&
      nextRankedMachines[0]?.[1] > nextRankedMachines[1]?.[1]
        ? nextRankedMachines[0][0]
        : "undecided";

    setAnswers(nextAnswers);
    setCopyStatus("idle");
    trackBusinessPlaybookPlannerInteraction({
      action: "select_fit_answer",
      question: questionId,
      answer: choiceId,
      recommendedMachine: nextRecommended,
      budgetMachine: budgetMachine ?? "not_selected",
    });
  };

  const handleBudgetMachineChange = (machine: PlannerMachineId) => {
    setBudgetMachine(machine);
    setBudget(plannerMachineProfiles[machine].defaultBudget);
    setBudgetWasEdited(true);
    trackBusinessPlaybookPlannerInteraction({
      action: "select_budget_machine",
      recommendedMachine: recommendedMachine?.id ?? "undecided",
      budgetMachine: machine,
    });
  };

  const handleBudgetChange = (key: PlannerBudgetKey, value: number) => {
    const safeValue = Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
    setBudget((current) => ({ ...current, [key]: safeValue }));
    setBudgetWasEdited(true);
    setCopyStatus("idle");
  };

  const handleCopySummary = async () => {
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
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

          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
                Interactive planning tool
              </p>
              <h1 className="mt-4 max-w-4xl font-display text-4xl font-bold leading-tight text-foreground sm:text-5xl">
                Machine Fit + Startup Budget Planner
              </h1>
              <p className="mt-5 max-w-3xl text-lg leading-relaxed text-muted-foreground">
                Answer a few operator-style questions, compare Commercial, Mini, and Micro fit,
                and sketch a practical launch budget before you pick a path or spend real money.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <a href="#fit-planner">
                    Start the planner
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </a>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link
                    to="/resources/business-playbook/startup-budget-checklist-cotton-candy-machine-business"
                    onClick={() =>
                      trackBusinessPlaybookCtaClick({
                        surface: "playbook_planner",
                        cta: "read_budget_guide",
                        href: "/resources/business-playbook/startup-budget-checklist-cotton-candy-machine-business",
                      })
                    }
                  >
                    Read budget guide
                  </Link>
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-background p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Lightbulb className="h-5 w-5" />
                </span>
                <h2 className="font-display text-xl font-bold text-foreground">
                  What this planner is
                </h2>
              </div>
              <ul className="mt-4 grid gap-3 text-sm text-muted-foreground">
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
                  A quick way to organize your thinking before comparing equipment or locations.
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
                  A cost sketch you can edit here without sharing private contact details.
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
                  Not legal, tax, insurance, permit, ROI, or profit advice.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section id="fit-planner" className="scroll-mt-24 py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="space-y-6">
              <div>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Sparkles className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="font-display text-3xl font-bold text-foreground">
                      Find the likely machine fit
                    </h2>
                    <p className="mt-1 text-muted-foreground">
                      Choose the closest answer. The goal is direction, not a perfect diagnosis.
                    </p>
                  </div>
                </div>
              </div>

              {plannerQuestions.map((question, questionIndex) => (
                <fieldset
                  key={question.id}
                  className="rounded-xl border border-border bg-background p-5 shadow-sm"
                >
                  <legend className="font-display text-xl font-bold text-foreground">
                    {questionIndex + 1}. {question.label}
                  </legend>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {question.helper}
                  </p>
                  <div className="mt-4 grid gap-3 lg:grid-cols-3">
                    {question.choices.map((choice) => {
                      const isSelected = answers[question.id] === choice.id;

                      return (
                        <button
                          key={choice.id}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => handleAnswerChange(question.id, choice.id)}
                          className={cn(
                            "rounded-lg border p-4 text-left transition-[border-color,box-shadow,background-color]",
                            isSelected
                              ? "border-primary bg-primary/5 shadow-sm"
                              : "border-border bg-muted/10 hover:border-primary/50"
                          )}
                        >
                          <span className="flex items-start gap-3">
                            <span
                              className={cn(
                                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                                isSelected
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border bg-background"
                              )}
                            >
                              {isSelected && <CheckCircle2 className="h-3.5 w-3.5" />}
                            </span>
                            <span>
                              <span className="block font-semibold text-foreground">
                                {choice.label}
                              </span>
                              <span className="mt-2 block text-sm leading-relaxed text-muted-foreground">
                                {choice.helper}
                              </span>
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>

            <aside className="space-y-5 xl:sticky xl:top-24 xl:self-start">
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                  Current fit signal
                </p>
                {recommendedMachine ? (
                  <>
                    <h2 className="mt-2 font-display text-2xl font-bold text-foreground">
                      {recommendedMachine.label}
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {recommendedMachine.bestFor}
                    </p>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      <span className="font-semibold text-foreground">Watch out:</span>{" "}
                      {recommendedMachine.watchOut}
                    </p>
                    <div className="mt-5 grid gap-2">
                      <Button asChild>
                        <Link
                          to={recommendedMachine.articleHref}
                          onClick={() =>
                            trackBusinessPlaybookCtaClick({
                              surface: "playbook_planner",
                              cta: recommendedMachine.articleLabel,
                              href: recommendedMachine.articleHref,
                              machine: recommendedMachine.label,
                            })
                          }
                        >
                          {recommendedMachine.articleLabel}
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                      </Button>
                      <Button asChild variant="outline">
                        <Link
                          to="/machines"
                          onClick={() =>
                            trackBusinessPlaybookCtaClick({
                              surface: "playbook_planner",
                              cta: "compare_machines",
                              href: "/machines",
                              machine: recommendedMachine.label,
                            })
                          }
                        >
                          Compare machines
                        </Link>
                      </Button>
                    </div>
                  </>
                ) : tiedMachines.length > 0 ? (
                  <>
                    <h2 className="mt-2 font-display text-2xl font-bold text-foreground">
                      Still a close call
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      Your answers are split between{" "}
                      {tiedMachines.map((machine) => machine.shortLabel).join(" and ")}.
                      That is useful: compare the operating model before choosing a machine.
                    </p>
                    <div className="mt-5 grid gap-2">
                      <Button asChild>
                        <Link to="/resources/business-playbook/commercial-vending-vs-event-catering">
                          Compare operating paths
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                      </Button>
                      <Button asChild variant="outline">
                        <Link to="/machines">Compare machines</Link>
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <h2 className="mt-2 font-display text-2xl font-bold text-foreground">
                      Start with two answers
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      Nothing is preselected. Answer at least two questions and the planner
                      will start showing a machine-fit signal.
                    </p>
                    <div className="mt-5 grid gap-2">
                      <Button asChild>
                        <a href="#fit-planner">
                          Answer the questions
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </a>
                      </Button>
                      <Button asChild variant="outline">
                        <Link to="/resources/business-playbook/how-to-start-cotton-candy-vending-business">
                          Read startup guide
                        </Link>
                      </Button>
                    </div>
                  </>
                )}
              </div>

              <div className="rounded-xl border border-border bg-background p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Fit comparison
                </p>
                <div className="mt-4 grid gap-4">
                  {rankedMachines.map((machine) => (
                    <div key={machine.id}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold text-foreground">{machine.shortLabel}</p>
                        <p className="text-sm font-semibold text-primary">{machine.score}</p>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.max(8, (machine.score / maxScore) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-muted/20 py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(22rem,1.1fr)] lg:items-start">
            <div>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber/10 text-amber">
                  <PiggyBank className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                    Budget sketch
                  </p>
                  <h2 className="font-display text-3xl font-bold text-foreground">
                    Turn fit into a launch checklist
                  </h2>
                </div>
              </div>
              <p className="mt-4 text-muted-foreground">
                These numbers are editable placeholders to help you prepare questions. Commercial
                machine pricing is quote-led; freight, tariffs, duties, accessories, and local
                requirements can vary by quote terms, city, venue, and business structure.
              </p>

              <div className="mt-6 rounded-xl border border-border bg-background p-5 shadow-sm">
                <p className="font-display text-lg font-bold text-foreground">
                  Budget scenario
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {(Object.keys(plannerMachineProfiles) as PlannerMachineId[]).map((machine) => (
                    <button
                      key={machine}
                      type="button"
                      aria-pressed={budgetMachine === machine}
                      onClick={() => handleBudgetMachineChange(machine)}
                      className={cn(
                        "rounded-lg border p-4 text-left transition-colors",
                        budgetMachine === machine
                          ? "border-primary bg-primary/5"
                          : "border-border bg-muted/10 hover:border-primary/50"
                      )}
                    >
                      <span className="block font-semibold text-foreground">
                        {plannerMachineProfiles[machine].shortLabel}
                      </span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {machine === "commercial"
                          ? "Machine quote needed"
                          : `${formatCurrency(plannerMachineProfiles[machine].defaultBudget.machine)} list price`}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-5 rounded-xl border border-border bg-background p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div>
                    <p className="font-display text-lg font-bold text-foreground">
                      Use this as your launch-notes checklist
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      If a row feels uncertain, mark it as an open question. Those gaps are often
                      exactly what you should clarify before buying equipment, booking an event, or
                      signing a venue agreement.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-background p-5 shadow-elevated">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {isCommercialQuoteNeeded ? "Known launch placeholders" : "Planning total"}
                  </p>
                  {budgetMachine ? (
                    isCommercialQuoteNeeded ? (
                      <>
                        <p className="mt-1 font-display text-3xl font-bold text-foreground">
                          Machine quote needed
                        </p>
                        <p className="mt-1 text-sm font-semibold text-muted-foreground">
                          + {formatCurrency(budgetTotal)} editable launch-prep placeholders
                        </p>
                      </>
                    ) : (
                      <p className="mt-1 font-display text-4xl font-bold text-foreground">
                        {formatCurrency(budgetTotal)}
                      </p>
                    )
                  ) : (
                    <p className="mt-1 font-display text-3xl font-bold text-foreground">
                      Choose a scenario
                    </p>
                  )}
                </div>
                <div className="rounded-lg bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
                  {isCommercialQuoteNeeded
                    ? "Commercial machine pricing is quote-led. Enter machine and landed-cost quotes when you have them; until then, the dollar amount can exclude machine, freight, tariffs, duties, or import fees."
                    : "Based on your editable inputs. No revenue, ROI, or profit assumptions included."}
                </div>
              </div>

              <div className="mt-6 grid gap-4">
                {budgetMachine ? (
                  budgetKeys.map((key) => {
                    const label = plannerBudgetLabels[key];
                    const helper =
                      key === "machine" && budgetMachine === "commercial"
                        ? "Leave this at 0 until you have a Commercial quote; the total will call out that machine cost is still unknown."
                        : key === "importFreight"
                          ? "Enter the actual landed-cost amount when you know whether shipping, tariffs, duties, customs, brokerage, or delivery are included in your quote."
                        : label.helper;

                    return (
                      <label key={key} className="grid gap-2 rounded-lg border border-border p-4">
                        <span className="font-semibold text-foreground">{label.label}</span>
                        <span className="text-sm leading-relaxed text-muted-foreground">
                          {helper}
                        </span>
                        <span className="relative mt-1">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
                            $
                          </span>
                          <input
                            aria-label={label.label}
                            type="number"
                            min="0"
                            step="50"
                            value={budget[key]}
                            onChange={(event) =>
                              handleBudgetChange(key, Number(event.currentTarget.value))
                            }
                            className="w-full rounded-lg border border-input bg-background px-8 py-2 text-sm font-semibold text-foreground"
                          />
                        </span>
                      </label>
                    );
                  })
                ) : (
                  <div className="rounded-lg border border-dashed border-border bg-muted/20 p-5 text-sm leading-relaxed text-muted-foreground">
                    Choose Commercial, Mini, or Micro above to open editable cost categories.
                    The planner will never estimate revenue, ROI, or profit for you.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="grid gap-6 rounded-xl border border-border bg-background p-6 shadow-sm lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ClipboardList className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                    Planner notes
                  </p>
                  <h2 className="font-display text-2xl font-bold text-foreground">
                    Keep the useful parts
                  </h2>
                </div>
              </div>
              <p className="mt-3 max-w-3xl leading-relaxed text-muted-foreground">
                Use this summary as your working notes. It keeps the fit signal, selected answers,
                budget snapshot, and open questions together without collecting your contact
                information.
              </p>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-border bg-muted/20 p-4">
                  <p className="font-semibold text-foreground">Fit signal</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {recommendedMachine
                      ? `${recommendedMachine.label}: ${recommendedMachine.bestFor}`
                      : tiedMachines.length > 0
                        ? `Close call between ${tiedMachines
                            .map((machine) => machine.shortLabel)
                            .join(" and ")}. Compare the operating model before choosing.`
                        : `Answer at least ${minimumAnswersForRecommendation} questions to see a signal.`}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-4">
                  <p className="font-semibold text-foreground">Budget snapshot</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {budgetSnapshot}
                  </p>
                </div>
              </div>

              <div className="mt-5 rounded-lg border border-border bg-muted/20 p-4">
                <p className="font-semibold text-foreground">Selected answers</p>
                <ul className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                  {selectedAnswerRows.map((row) => (
                    <li key={row.question}>
                      <span className="font-medium text-foreground">{row.question}</span>
                      <br />
                      {row.answer}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:min-w-56">
              <Button type="button" onClick={handleCopySummary}>
                <Copy className="mr-2 h-4 w-4" />
                Copy summary
              </Button>
              <Button type="button" variant="outline" onClick={() => window.print()}>
                <Printer className="mr-2 h-4 w-4" />
                Print plan
              </Button>
              {copyStatus !== "idle" && (
                <p className="text-sm text-muted-foreground">
                  {copyStatus === "copied"
                    ? "Copied. You can paste it into notes or an email draft."
                    : "Copy did not work in this browser. Print is still available."}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 sm:p-8">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div>
                <div className="flex items-center gap-3">
                  <Calculator className="h-6 w-6 text-primary" />
                  <h2 className="font-display text-2xl font-bold text-foreground">
                    Next best step
                  </h2>
                </div>
                <p className="mt-3 max-w-3xl leading-relaxed text-muted-foreground">
                  When you are ready, bring your fit signal, budget unknowns, target setting, and
                  timeline to Bloomjoy. We can help pressure-test the plan before you spend.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                <Button asChild size="lg">
                  <Link
                    to={finalQuoteHref}
                    onClick={() =>
                      trackBusinessPlaybookCtaClick({
                        surface: "playbook_planner",
                        cta: "planner_final_quote_cta",
                        href: finalQuoteHref,
                        machine: quoteMachine ? plannerMachineProfiles[quoteMachine].label : undefined,
                      })
                    }
                  >
                    Request a quote
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link to="/resources/business-playbook">Keep reading</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}

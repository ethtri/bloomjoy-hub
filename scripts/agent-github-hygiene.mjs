#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const repo = args.repo || process.env.AGENT_REPO || "ethtri/bloomjoy-hub";
const projectOwner = args["project-owner"] || process.env.AGENT_PROJECT_OWNER || "ethtri";
const projectNumber = args["project-number"] || process.env.AGENT_PROJECT_NUMBER || "2";
const maxItems = Number(args["max-items"] || 15);
const inProgressDays = Number(args["in-progress-days"] || 7);
const priorityDays = Number(args["priority-days"] || 7);
const todoDays = Number(args["todo-days"] || 30);
const prDays = Number(args["pr-days"] || 7);
const outputJson = Boolean(args.json);
const failOnFindings = Boolean(args["fail-on-findings"]);
const now = new Date();

const priorityLabels = ["P0", "P1", "P2", "P3"];
const redLabels = new Set([
  "blocked",
  "blocked-external",
  "needs-owner-decision",
  "risky-auth-payment",
  "risky-db-change",
  "uat-required",
]);
const blockerLabels = new Set(["blocked", "blocked-external", "needs-owner-decision", "parked"]);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;

    const [rawKey, rawValue] = arg.slice(2).split("=");
    if (rawValue !== undefined) {
      parsed[rawKey] = rawValue;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[rawKey] = next;
      index += 1;
    } else {
      parsed[rawKey] = "true";
    }
  }
  return parsed;
}

function runJson(command, commandArgs) {
  try {
    const stdout = execFileSync(command, commandArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return stdout ? JSON.parse(stdout) : null;
  } catch (error) {
    const stderr = error.stderr?.toString().trim() || error.message;
    throw new Error(`Command failed: ${command} ${commandArgs.join(" ")}\n${stderr}`);
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function labelNames(item) {
  return asArray(item?.labels).map((label) => (typeof label === "string" ? label : label.name));
}

function hasLabel(item, label) {
  return labelNames(item).includes(label);
}

function hasAnyLabel(item, labels) {
  const names = labelNames(item);
  return names.some((label) => labels.has(label));
}

function daysSince(dateValue) {
  if (!dateValue) return Number.POSITIVE_INFINITY;
  const date = new Date(dateValue);
  if (Number.isNaN(date.valueOf())) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now.valueOf() - date.valueOf()) / 86_400_000));
}

function latestCommentAt(issue) {
  const comments = asArray(issue.comments)
    .map((comment) => comment.createdAt)
    .filter(Boolean)
    .sort();
  return comments.at(-1) || "";
}

function linkedIssueNumbers(body) {
  const numbers = new Set();
  const regex = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|issue|linked issue)?\s*#(\d+)/gi;
  let match;
  while ((match = regex.exec(String(body ?? "")))) numbers.add(Number(match[1]));
  return [...numbers];
}

function projectIssueItems(project) {
  return asArray(project.items).filter((item) => item.content?.type === "Issue" && item.content?.repository === repo);
}

function countBy(items, select) {
  const counts = {};
  for (const item of items) {
    const key = select(item) || "(none)";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function priorityRank(issue) {
  const names = labelNames(issue);
  const index = priorityLabels.findIndex((label) => names.includes(label));
  return index === -1 ? 99 : index;
}

function formatIssue(issue, extra = "") {
  const suffix = extra ? ` - ${extra}` : "";
  return `- [#${issue.number} ${issue.title}](${issue.url})${suffix}`;
}

function formatPr(pr, extra = "") {
  const suffix = extra ? ` - ${extra}` : "";
  return `- [#${pr.number} ${pr.title}](${pr.url})${suffix}`;
}

function renderList(title, items, formatter) {
  const lines = [`### ${title}`, ""];
  if (!items.length) {
    lines.push("- None");
    lines.push("");
    return lines;
  }

  const visible = items.slice(0, maxItems);
  for (const item of visible) lines.push(formatter(item));
  if (items.length > visible.length) lines.push(`- ...and ${items.length - visible.length} more`);
  lines.push("");
  return lines;
}

function collectPrLabels(pr, issuesByNumber) {
  const labels = new Set(labelNames(pr));
  for (const issueNumber of linkedIssueNumbers(pr.body)) {
    for (const label of labelNames(issuesByNumber.get(issueNumber))) labels.add(label);
  }
  return [...labels];
}

function prAttentionReasons(pr, issuesByNumber) {
  const reasons = [];
  const linkedIssues = linkedIssueNumbers(pr.body);
  const labels = collectPrLabels(pr, issuesByNumber);
  const red = labels.filter((label) => redLabels.has(label));
  const age = daysSince(pr.updatedAt);

  if (!linkedIssues.length) reasons.push("no linked issue in PR body");
  if (pr.isDraft) reasons.push("draft");
  if (pr.baseRefName !== "main") reasons.push(`targets ${pr.baseRefName}, not main`);
  if (!["CLEAN", "HAS_HOOKS"].includes(pr.mergeStateStatus)) reasons.push(`merge state ${pr.mergeStateStatus}`);
  if (red.length) reasons.push(`red-lane labels: ${red.join(", ")}`);
  if (age >= prDays) reasons.push(`${age}d since PR update`);

  return {
    linkedIssues,
    labels,
    reasons,
  };
}

function issueStatusCommentAge(issue) {
  return daysSince(latestCommentAt(issue) || issue.createdAt);
}

const issues = runJson("gh", [
  "issue",
  "list",
  "--repo",
  repo,
  "--state",
  "open",
  "--limit",
  "1000",
  "--json",
  "number,title,url,labels,createdAt,updatedAt,comments,projectItems",
]);

const prs = runJson("gh", [
  "pr",
  "list",
  "--repo",
  repo,
  "--state",
  "open",
  "--limit",
  "200",
  "--json",
  "number,title,url,body,labels,isDraft,mergeStateStatus,updatedAt,headRefName,baseRefName",
]);

const project = runJson("gh", [
  "project",
  "item-list",
  projectNumber,
  "--owner",
  projectOwner,
  "--limit",
  "1000",
  "--format",
  "json",
]);

const issuesByNumber = new Map(issues.map((issue) => [Number(issue.number), issue]));
const openIssueNumbers = new Set(issues.map((issue) => Number(issue.number)));
const projectItems = projectIssueItems(project);
const projectByNumber = new Map(projectItems.map((item) => [Number(item.content.number), item]));
const openProjectItems = projectItems.filter((item) => openIssueNumbers.has(Number(item.content.number)));

const missingProject = issues
  .filter((issue) => !projectByNumber.has(Number(issue.number)))
  .sort((a, b) => priorityRank(a) - priorityRank(b) || Number(a.number) - Number(b.number));

const missingPriority = issues.filter(
  (issue) => labelNames(issue).filter((label) => priorityLabels.includes(label)).length === 0,
);
const multiplePriority = issues.filter(
  (issue) => labelNames(issue).filter((label) => priorityLabels.includes(label)).length > 1,
);

const openDone = openProjectItems.filter((item) => item.status === "Done");
const openNoStatus = openProjectItems.filter((item) => !item.status);
const staleInProgress = openProjectItems
  .filter((item) => item.status === "In Progress")
  .map((item) => {
    const issue = issuesByNumber.get(Number(item.content.number));
    const reasons = [];
    const issueAge = daysSince(issue?.updatedAt);
    const statusAge = issue ? issueStatusCommentAge(issue) : Number.POSITIVE_INFINITY;
    const linkedPrs = asArray(item["linked pull requests"]);

    if (issueAge >= inProgressDays) reasons.push(`${issueAge}d since issue update`);
    if (statusAge >= inProgressDays) reasons.push(`${statusAge}d since status comment`);
    if (issue && hasAnyLabel(issue, blockerLabels)) {
      reasons.push(`blocker label: ${labelNames(issue).filter((label) => blockerLabels.has(label)).join(", ")}`);
    }
    if (!linkedPrs.length && issueAge >= inProgressDays) reasons.push("no linked PR on board item");

    return { issue, reasons };
  })
  .filter((item) => item.issue && item.reasons.length)
  .sort((a, b) => priorityRank(a.issue) - priorityRank(b.issue) || daysSince(b.issue.updatedAt) - daysSince(a.issue.updatedAt));

const stalePriorityIssues = issues
  .filter((issue) => hasLabel(issue, "P0") || hasLabel(issue, "P1"))
  .map((issue) => ({ issue, statusAge: issueStatusCommentAge(issue) }))
  .filter(({ statusAge }) => statusAge >= priorityDays)
  .sort((a, b) => priorityRank(a.issue) - priorityRank(b.issue) || b.statusAge - a.statusAge);

const staleLowerPriorityTodo = openProjectItems
  .filter((item) => item.status === "Todo")
  .map((item) => issuesByNumber.get(Number(item.content.number)))
  .filter((issue) => issue && !hasLabel(issue, "P0") && !hasLabel(issue, "P1"))
  .map((issue) => ({ issue, age: daysSince(issue.updatedAt) }))
  .filter(({ age, issue }) => age >= todoDays && !hasAnyLabel(issue, blockerLabels))
  .sort((a, b) => b.age - a.age);

const ownerDecisionQueue = issues
  .filter((issue) => hasAnyLabel(issue, blockerLabels))
  .sort((a, b) => priorityRank(a) - priorityRank(b) || daysSince(b.updatedAt) - daysSince(a.updatedAt));

const prAttention = prs
  .map((pr) => ({ pr, ...prAttentionReasons(pr, issuesByNumber) }))
  .filter((item) => item.reasons.length)
  .sort((a, b) => daysSince(b.pr.updatedAt) - daysSince(a.pr.updatedAt));

const statusCounts = countBy(project.items ?? [], (item) => item.status);
const openStatusCounts = countBy(openProjectItems, (item) => item.status);
const priorityCounts = Object.fromEntries(
  priorityLabels.map((label) => [label, issues.filter((issue) => hasLabel(issue, label)).length]),
);
const riskCounts = Object.fromEntries(
  [...redLabels, "parked", "ui-change", "docs-only"].map((label) => [
    label,
    issues.filter((issue) => hasLabel(issue, label)).length,
  ]),
);

const findingGroups = [
  missingProject,
  missingPriority,
  multiplePriority,
  openDone,
  openNoStatus,
  staleInProgress,
  stalePriorityIssues,
  staleLowerPriorityTodo,
  ownerDecisionQueue,
  prAttention,
];
const findingCount = findingGroups.reduce((total, items) => total + items.length, 0);

const report = {
  generatedAt: now.toISOString(),
  repo,
  project: `${projectOwner}/${projectNumber}`,
  thresholds: {
    inProgressDays,
    priorityDays,
    todoDays,
    prDays,
  },
  summary: {
    openIssues: issues.length,
    openPrs: prs.length,
    projectItems: project.totalCount ?? asArray(project.items).length,
    projectStatusCounts: statusCounts,
    openIssueProjectStatusCounts: openStatusCounts,
    priorityCounts,
    riskCounts,
    findingCount,
  },
  findings: {
    missingProject,
    missingPriority,
    multiplePriority,
    openDone,
    openNoStatus,
    staleInProgress,
    stalePriorityIssues,
    staleLowerPriorityTodo,
    ownerDecisionQueue,
    prAttention,
  },
};

if (outputJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const lines = [];
  lines.push("# GitHub Hygiene Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Repo: ${repo}`);
  lines.push(`Project: ${projectOwner}/${projectNumber}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Open issues: ${issues.length}`);
  lines.push(`- Open PRs: ${prs.length}`);
  lines.push(`- Project items: ${report.summary.projectItems}`);
  lines.push(
    `- Open issue board status: ${Object.entries(openStatusCounts)
      .map(([status, count]) => `${status} ${count}`)
      .join(", ") || "none"}`,
  );
  lines.push(
    `- Open priority split: ${priorityLabels.map((label) => `${label} ${priorityCounts[label]}`).join(", ")}`,
  );
  lines.push(`- Findings: ${findingCount}`);
  lines.push("");

  lines.push("## Findings");
  lines.push("");
  lines.push(
    ...renderList("Open Issues Missing From Project Board", missingProject, (issue) =>
      formatIssue(issue, labelNames(issue).join(", ")),
    ),
  );
  lines.push(
    ...renderList("Priority Label Problems", [...missingPriority, ...multiplePriority], (issue) => {
      const priorities = labelNames(issue).filter((label) => priorityLabels.includes(label));
      return formatIssue(issue, priorities.length ? `priority labels: ${priorities.join(", ")}` : "missing priority label");
    }),
  );
  lines.push(
    ...renderList("Open Issues With Board Status Problems", [...openDone, ...openNoStatus], (item) =>
      formatIssue(item.content, `board status: ${item.status || "none"}`),
    ),
  );
  lines.push(
    ...renderList("Stale Or Blocked In Progress Issues", staleInProgress, ({ issue, reasons }) =>
      formatIssue(issue, reasons.join("; ")),
    ),
  );
  lines.push(
    ...renderList("P0/P1 Issues Needing Fresh Status Comment", stalePriorityIssues, ({ issue, statusAge }) =>
      formatIssue(issue, `${statusAge}d since latest issue comment`),
    ),
  );
  lines.push(
    ...renderList("Older P2/P3 Todo Items To Park, Reprioritize, Or Close", staleLowerPriorityTodo, ({ issue, age }) =>
      formatIssue(issue, `${age}d since issue update`),
    ),
  );
  lines.push(
    ...renderList("Owner Decision Or Blocker Queue", ownerDecisionQueue, (issue) =>
      formatIssue(issue, labelNames(issue).filter((label) => blockerLabels.has(label)).join(", ")),
    ),
  );
  lines.push(
    ...renderList("Open PRs Needing Hygiene Attention", prAttention, ({ pr, reasons }) =>
      formatPr(pr, reasons.join("; ")),
    ),
  );

  lines.push("## Healthy Checks");
  lines.push("");
  lines.push(
    missingPriority.length || multiplePriority.length
      ? "- Priority labeling needs cleanup."
      : "- Every open issue has exactly one P0-P3 priority label.",
  );
  lines.push(missingProject.length ? "- Some open issues are missing from the project board." : "- Every open issue is on the project board.");
  lines.push(openDone.length ? "- Some open issues are marked Done on the board." : "- No open issue is marked Done on the board.");
  lines.push("");
  lines.push("## Recommended Sweep Actions");
  lines.push("");
  lines.push("1. Add missing open issues to the Bloomjoy Project board.");
  lines.push("2. Move blocked or parked work out of active In Progress unless an agent is actively unblocking it.");
  lines.push("3. Add short status comments to stale P0/P1 issues, especially owner/blocker items.");
  lines.push("4. Close, park, or rebuild stale PRs after merge-gate and owner-approval rules are applied.");
  lines.push("5. Keep task chronology in issue/PR comments; update repo docs only for durable decisions or compact launch snapshots.");
  lines.push("");

  console.log(lines.join("\n"));
}

if (failOnFindings && findingCount > 0) {
  process.exitCode = 1;
}

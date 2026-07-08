#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const args = parseArgs(process.argv.slice(2));
const repo = args.repo || process.env.AGENT_REPO || "ethtri/bloomjoy-hub";
const staleDays = Number(args["stale-days"] || 14);
const maxItems = Number(args["max-items"] || 25);
const outputJson = hasFlag(args, "json");
const failOnFindings = hasFlag(args, "fail-on-findings");
const now = new Date();
const warnings = [];

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

function hasFlag(parsed, key) {
  return parsed[key] === "true" || parsed[key] === true;
}

function run(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function runOrNull(command, commandArgs, options = {}) {
  try {
    return run(command, commandArgs, options);
  } catch (error) {
    warnings.push(`${command} ${commandArgs.join(" ")} failed: ${error.stderr?.toString().trim() || error.message}`);
    return null;
  }
}

function runJsonOrEmpty(command, commandArgs) {
  const stdout = runOrNull(command, commandArgs);
  if (!stdout) return [];
  try {
    return JSON.parse(stdout);
  } catch (error) {
    warnings.push(`Could not parse JSON from ${command} ${commandArgs.join(" ")}: ${error.message}`);
    return [];
  }
}

function parseWorktrees(source) {
  const records = [];
  let current = null;

  for (const line of source.split(/\r?\n/)) {
    if (!line.trim()) {
      if (current) records.push(current);
      current = null;
      continue;
    }

    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");

    if (key === "worktree") {
      if (current) records.push(current);
      current = {
        path: value,
        head: "",
        branch: "",
        detached: false,
        bare: false,
        prunable: "",
      };
      continue;
    }

    if (!current) continue;
    if (key === "HEAD") current.head = value;
    if (key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
    if (key === "detached") current.detached = true;
    if (key === "bare") current.bare = true;
    if (key === "prunable") current.prunable = value || "yes";
  }

  if (current) records.push(current);
  return records;
}

function parseBranches(source) {
  if (!source) return [];
  return source
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, committedAt, upstream, worktreePath, head] = line.split("\t");
      return { name, committedAt, upstream, worktreePath, head };
    });
}

function statusFor(worktreePath) {
  if (!existsSync(worktreePath)) {
    return {
      exists: false,
      dirty: false,
      trackedCount: 0,
      untrackedCount: 0,
      untrackedExamples: [],
      error: "path does not exist",
    };
  }

  const stdout = runOrNull("git", ["-C", worktreePath, "status", "--porcelain=v1"]);
  if (stdout === null) {
    return {
      exists: true,
      dirty: true,
      trackedCount: 0,
      untrackedCount: 0,
      untrackedExamples: [],
      error: "git status failed",
    };
  }

  const lines = stdout.split(/\r?\n/).filter(Boolean);
  const untracked = lines.filter((line) => line.startsWith("?? "));
  const tracked = lines.filter((line) => !line.startsWith("?? "));

  return {
    exists: true,
    dirty: lines.length > 0,
    trackedCount: tracked.length,
    untrackedCount: untracked.length,
    untrackedExamples: untracked.slice(0, 8).map((line) => line.slice(3)),
    error: "",
  };
}

function daysSince(dateValue) {
  if (!dateValue) return Number.POSITIVE_INFINITY;
  const date = new Date(dateValue);
  if (Number.isNaN(date.valueOf())) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now.valueOf() - date.valueOf()) / 86_400_000));
}

function issueMentionsBranch(issue, branchName) {
  const slug = branchName.replace(/^agent\//, "");
  const source = `${issue.title || ""}\n${issue.body || ""}`.toLowerCase();
  return source.includes(branchName.toLowerCase()) || source.includes(slug.toLowerCase());
}

function groupBy(items, keyFor) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFor(item);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ key, group }));
}

function compactPr(pr) {
  if (!pr) return null;
  return {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    isDraft: pr.isDraft,
    url: pr.url,
    updatedAt: pr.updatedAt,
    mergedAt: pr.mergedAt,
    closedAt: pr.closedAt,
  };
}

function compactWorktree(worktree) {
  return {
    path: worktree.path,
    branch: worktree.branch || "(detached)",
    head: worktree.head,
    upstream: worktree.upstream || "",
    dirty: worktree.status.dirty,
    trackedCount: worktree.status.trackedCount,
    untrackedCount: worktree.status.untrackedCount,
    untrackedExamples: worktree.status.untrackedExamples,
    pr: compactPr(worktree.pr),
    reasons: worktree.reasons,
  };
}

function renderList(title, items, formatter) {
  const lines = [`### ${title}`, ""];
  if (!items.length) {
    lines.push("- None");
    lines.push("");
    return lines;
  }

  for (const item of items.slice(0, maxItems)) lines.push(formatter(item));
  if (items.length > maxItems) lines.push(`- ...and ${items.length - maxItems} more`);
  lines.push("");
  return lines;
}

function formatWorktree(item) {
  const dirty = item.status.dirty
    ? `dirty: ${item.status.trackedCount} tracked, ${item.status.untrackedCount} untracked`
    : "clean";
  const pr = item.pr ? `PR #${item.pr.number} ${item.pr.state}` : "no PR";
  const reasons = item.reasons.length ? ` - ${item.reasons.join("; ")}` : "";
  return `- \`${item.path}\` on \`${item.branch || "(detached)"}\` (${dirty}, ${pr})${reasons}`;
}

const worktrees = parseWorktrees(run("git", ["worktree", "list", "--porcelain"]));
const branches = parseBranches(
  run("git", [
    "for-each-ref",
    "refs/heads",
    "--format=%(refname:short)%09%(committerdate:iso8601)%09%(upstream:short)%09%(worktreepath)%09%(objectname)",
  ]),
);
const prs = runJsonOrEmpty("gh", [
  "pr",
  "list",
  "--repo",
  repo,
  "--state",
  "all",
  "--limit",
  "1000",
  "--json",
  "number,title,url,state,isDraft,headRefName,baseRefName,updatedAt,closedAt,mergedAt",
]);
const openIssues = runJsonOrEmpty("gh", [
  "issue",
  "list",
  "--repo",
  repo,
  "--state",
  "open",
  "--limit",
  "1000",
  "--json",
  "number,title,url,body,labels,updatedAt",
]);

const branchByName = new Map(branches.map((branch) => [branch.name, branch]));
const prsByHead = new Map();
for (const pr of prs) {
  if (!prsByHead.has(pr.headRefName)) prsByHead.set(pr.headRefName, []);
  prsByHead.get(pr.headRefName).push(pr);
}

for (const group of prsByHead.values()) {
  group.sort((a, b) => {
    const aOpen = a.state === "OPEN" ? 0 : 1;
    const bOpen = b.state === "OPEN" ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return Number(b.number) - Number(a.number);
  });
}

const enrichedWorktrees = worktrees.map((worktree) => {
  const branch = branchByName.get(worktree.branch);
  const branchPrs = prsByHead.get(worktree.branch) || [];
  const pr = branchPrs[0] || null;
  const openPr = branchPrs.find((candidate) => candidate.state === "OPEN") || null;
  const status = statusFor(worktree.path);
  const issueEvidence = worktree.branch ? openIssues.filter((issue) => issueMentionsBranch(issue, worktree.branch)) : [];
  const branchAge = daysSince(branch?.committedAt);
  const reasons = [];

  if (worktree.detached || !worktree.branch) reasons.push("detached");
  if (worktree.prunable) reasons.push(`prunable: ${worktree.prunable}`);
  if (status.dirty) reasons.push(`${status.trackedCount} tracked and ${status.untrackedCount} untracked local changes`);
  if (pr && pr.state !== "OPEN") reasons.push(`PR #${pr.number} is ${pr.state.toLowerCase()}`);
  if (openPr) reasons.push(`open PR #${openPr.number}`);
  if (!openPr && issueEvidence.length) reasons.push(`open issue evidence: ${issueEvidence.map((issue) => `#${issue.number}`).join(", ")}`);
  if (!openPr && !issueEvidence.length && worktree.branch?.startsWith("agent/") && branchAge >= staleDays) {
    reasons.push(`${branchAge}d old with no open PR or issue evidence`);
  }

  return {
    ...worktree,
    upstream: branch?.upstream || "",
    branchCommittedAt: branch?.committedAt || "",
    branchAge,
    status,
    pr,
    openPr,
    issueEvidence,
    reasons,
  };
});

const agentBranches = branches.filter((branch) => branch.name.startsWith("agent/"));
const localBranchesWithoutOpenPrOrIssue = agentBranches
  .map((branch) => {
    const openPr = (prsByHead.get(branch.name) || []).find((pr) => pr.state === "OPEN") || null;
    const issueEvidence = openIssues.filter((issue) => issueMentionsBranch(issue, branch.name));
    return {
      ...branch,
      age: daysSince(branch.committedAt),
      openPr,
      issueEvidence,
    };
  })
  .filter((branch) => !branch.openPr && !branch.issueEvidence.length)
  .sort((a, b) => b.age - a.age);

const mergedOrClosedPrWorktrees = enrichedWorktrees
  .filter((worktree) => worktree.pr && worktree.pr.state !== "OPEN")
  .sort((a, b) => daysSince(b.pr.updatedAt) - daysSince(a.pr.updatedAt));
const safeRemoveCandidates = mergedOrClosedPrWorktrees.filter((worktree) => !worktree.status.dirty);
const archiveBeforeRemoveCandidates = mergedOrClosedPrWorktrees.filter((worktree) => worktree.status.dirty);
const detachedWorktrees = enrichedWorktrees.filter((worktree) => worktree.detached || !worktree.branch);
const dirtyWorktrees = enrichedWorktrees.filter((worktree) => worktree.status.dirty);
const staleNoEvidenceWorktrees = enrichedWorktrees
  .filter(
    (worktree) =>
      worktree.branch?.startsWith("agent/") &&
      !worktree.openPr &&
      !worktree.issueEvidence.length &&
      worktree.branchAge >= staleDays,
  )
  .sort((a, b) => b.branchAge - a.branchAge);
const duplicateBranches = groupBy(enrichedWorktrees, (worktree) => worktree.branch);
const duplicateHeads = groupBy(enrichedWorktrees, (worktree) => worktree.head);
const duplicateUpstreams = groupBy(enrichedWorktrees, (worktree) => worktree.upstream);

const findingCount =
  safeRemoveCandidates.length +
  archiveBeforeRemoveCandidates.length +
  detachedWorktrees.length +
  dirtyWorktrees.length +
  staleNoEvidenceWorktrees.length +
  duplicateBranches.length +
  duplicateHeads.length +
  duplicateUpstreams.length +
  localBranchesWithoutOpenPrOrIssue.length;

const report = {
  generatedAt: now.toISOString(),
  repo,
  thresholds: {
    staleDays,
  },
  summary: {
    worktrees: enrichedWorktrees.length,
    localBranches: branches.length,
    localAgentBranches: agentBranches.length,
    openPrs: prs.filter((pr) => pr.state === "OPEN").length,
    safeRemoveCandidates: safeRemoveCandidates.length,
    archiveBeforeRemoveCandidates: archiveBeforeRemoveCandidates.length,
    dirtyWorktrees: dirtyWorktrees.length,
    detachedWorktrees: detachedWorktrees.length,
    staleNoEvidenceWorktrees: staleNoEvidenceWorktrees.length,
    localAgentBranchesWithoutOpenPrOrIssue: localBranchesWithoutOpenPrOrIssue.length,
    findingCount,
  },
  findings: {
    safeRemoveCandidates: safeRemoveCandidates.map(compactWorktree),
    archiveBeforeRemoveCandidates: archiveBeforeRemoveCandidates.map(compactWorktree),
    dirtyWorktrees: dirtyWorktrees.map(compactWorktree),
    detachedWorktrees: detachedWorktrees.map(compactWorktree),
    staleNoEvidenceWorktrees: staleNoEvidenceWorktrees.map(compactWorktree),
    duplicateBranches: duplicateBranches.map(({ key, group }) => ({ key, worktrees: group.map(compactWorktree) })),
    duplicateHeads: duplicateHeads.map(({ key, group }) => ({ key, worktrees: group.map(compactWorktree) })),
    duplicateUpstreams: duplicateUpstreams.map(({ key, group }) => ({ key, worktrees: group.map(compactWorktree) })),
    localBranchesWithoutOpenPrOrIssue: localBranchesWithoutOpenPrOrIssue.map((branch) => ({
      name: branch.name,
      committedAt: branch.committedAt,
      age: branch.age,
      upstream: branch.upstream,
      worktreePath: branch.worktreePath,
      head: branch.head,
    })),
  },
  warnings,
};

if (outputJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const lines = [];
  lines.push("# Worktree Hygiene Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Repo: ${repo}`);
  lines.push(`Stale threshold: ${staleDays} days`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Worktrees: ${report.summary.worktrees}`);
  lines.push(`- Local branches: ${report.summary.localBranches}`);
  lines.push(`- Local agent branches: ${report.summary.localAgentBranches}`);
  lines.push(`- Open PRs: ${report.summary.openPrs}`);
  lines.push(`- Clean merged/closed PR worktrees ready to remove: ${report.summary.safeRemoveCandidates}`);
  lines.push(`- Dirty merged/closed PR worktrees to archive before removal: ${report.summary.archiveBeforeRemoveCandidates}`);
  lines.push(`- Dirty worktrees: ${report.summary.dirtyWorktrees}`);
  lines.push(`- Detached worktrees: ${report.summary.detachedWorktrees}`);
  lines.push(`- Stale agent worktrees with no open PR or issue evidence: ${report.summary.staleNoEvidenceWorktrees}`);
  lines.push(`- Local agent branches with no open PR or issue evidence: ${report.summary.localAgentBranchesWithoutOpenPrOrIssue}`);
  lines.push(`- Findings: ${findingCount}`);
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  lines.push(...renderList("Clean Merged Or Closed PR Worktrees Ready To Remove", safeRemoveCandidates, formatWorktree));
  lines.push(...renderList("Dirty Merged Or Closed PR Worktrees To Archive Before Removal", archiveBeforeRemoveCandidates, formatWorktree));
  lines.push(...renderList("Dirty Worktrees", dirtyWorktrees, formatWorktree));
  lines.push(...renderList("Detached Worktrees", detachedWorktrees, formatWorktree));
  lines.push(...renderList("Stale Agent Worktrees With No Open PR Or Issue Evidence", staleNoEvidenceWorktrees, formatWorktree));
  lines.push(
    ...renderList("Duplicate HEAD Worktree Groups", duplicateHeads, ({ key, group }) => {
      const paths = group.map((worktree) => `\`${worktree.path}\``).join(", ");
      return `- \`${key}\`: ${paths}`;
    }),
  );
  lines.push(
    ...renderList("Duplicate Upstream Worktree Groups", duplicateUpstreams, ({ key, group }) => {
      const paths = group.map((worktree) => `\`${worktree.path}\` on \`${worktree.branch}\``).join(", ");
      return `- \`${key}\`: ${paths}`;
    }),
  );
  lines.push(
    ...renderList("Local Agent Branches With No Open PR Or Issue Evidence", localBranchesWithoutOpenPrOrIssue, (branch) => {
      const where = branch.worktreePath ? ` checked out at \`${branch.worktreePath}\`` : " not checked out";
      const upstream = branch.upstream ? `, upstream \`${branch.upstream}\`` : ", no upstream";
      return `- \`${branch.name}\` (${branch.age}d old${upstream}${where})`;
    }),
  );

  lines.push("## Recommended Sweep Actions");
  lines.push("");
  lines.push("1. Remove clean merged/closed PR worktrees with `git worktree remove <path>`.");
  lines.push("2. For dirty merged/closed worktrees, inspect `git status -sb`; archive generated artifacts outside the repo before removal.");
  lines.push("3. For duplicate HEAD/upstream groups, keep only the active PR or assigned QA worktree.");
  lines.push("4. For stale branches with no open PR or issue evidence, create an issue, close/supersede the work, or delete the local branch after confirming it is not needed.");
  lines.push("5. Run `git fetch --prune origin` and `git worktree prune` after cleanup.");
  lines.push("");

  if (warnings.length) {
    lines.push("## Warnings");
    lines.push("");
    for (const warning of warnings) lines.push(`- ${warning}`);
    lines.push("");
  }

  console.log(lines.join("\n"));
}

if (failOnFindings && findingCount > 0) {
  process.exitCode = 1;
}

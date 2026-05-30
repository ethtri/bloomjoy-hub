#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import path from "node:path";

const cwd = process.cwd();
const args = parseArgs(process.argv.slice(2));
const issueNumber = args.issue || process.env.AGENT_ISSUE || inferIssueFromBranch();

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.slice(2).split("=");
    parsed[key] = value ?? argv[index + 1] ?? "";
    if (value === undefined && argv[index + 1] && !argv[index + 1].startsWith("--")) index += 1;
  }
  return parsed;
}

function run(command, commandArgs, options = {}) {
  try {
    return {
      ok: true,
      stdout: execFileSync(command, commandArgs, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        ...options,
      }).trim(),
    };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout?.toString().trim() ?? "",
      stderr: error.stderr?.toString().trim() ?? error.message,
    };
  }
}

function runJson(command, commandArgs) {
  const result = run(command, commandArgs);
  if (!result.ok || !result.stdout) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function inferIssueFromBranch() {
  const branch = run("git", ["branch", "--show-current"]);
  if (!branch.ok) return "";
  const match = branch.stdout.match(/(?:issue-|#)(\d+)/i);
  return match?.[1] ?? "";
}

function truncate(value, maxLength = 900) {
  const text = String(value ?? "").replace(/\r\n/g, "\n").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function labelNames(issue) {
  return issue?.labels?.map((label) => label.name).join(", ") || "none";
}

function projectStatus(issue) {
  const items = issue?.projectItems ?? [];
  if (!items.length) return "none";
  return items
    .map((item) => `${item.title}: ${item.status?.name ?? "no status"}`)
    .join("; ");
}

function isMatch(haystack, pattern) {
  return pattern.test(haystack);
}

function taskHaystack(issue) {
  const body = String(issue?.body ?? "")
    .replace(/## Sensitive data warning[\s\S]*$/i, "")
    .replace(/## Expected verification[\s\S]*?(?=\n## |$)/i, "");
  return `${issue?.title ?? ""}\n${body}\n${labelNames(issue)}`.toLowerCase();
}

function buildDocList(issue) {
  const haystack = taskHaystack(issue);
  const docs = new Set([
    "AGENTS.md",
    "Docs/LOCAL_DEV.md",
    "Docs/DECISIONS.md",
    "Docs/TASK_TEMPLATE.md",
  ]);

  if (isMatch(haystack, /ui|ux|frontend|design|visual|mobile|responsive|page|screen|component|portal|admin|operator|public/)) {
    docs.add("PRODUCT.md");
    docs.add("DESIGN.md");
    docs.add("Docs/QA_SMOKE_TEST_CHECKLIST.md");
    docs.add("Docs/UAT_PERSONA_PLAYBOOK.md");
  }

  if (isMatch(haystack, /deploy|production|rollback|release|vercel|edge function|secret/)) {
    docs.add("Docs/PRODUCTION_RUNBOOK.md");
  }

  if (isMatch(haystack, /architecture|platform|database|migration|supabase|rls|rpc|schema|auth|stripe|payment|refund|reporting|vendor|sunze|nayax/)) {
    docs.add("Docs/ARCHITECTURE.md");
  }

  return [...docs];
}

function buildVerification(issue) {
  const issueArg = issue?.number ? ` -- --issue ${issue.number}` : "";
  const haystack = taskHaystack(issue);
  const commands = [
    "npm ci",
    `npm run agent:preflight${issueArg}`,
    "npm run build",
    "npm test --if-present",
    "npm run lint --if-present",
    "git diff --check",
  ];

  if (isMatch(haystack, /agent|workflow|template|codex|issue form|pull request template|docs\/task_template|agents\.md/)) {
    commands.splice(2, 0, "npm run agent:validate-workflow");
  }

  if (isMatch(haystack, /auth|oauth|login|access|role|permission|entitlement/)) {
    commands.splice(-1, 0, "npm run auth:preflight");
  }

  if (isMatch(haystack, /stripe|payment|checkout|order|commerce|refund/)) {
    commands.splice(-1, 0, "npm run commerce:preflight");
  }

  if (isMatch(haystack, /database|migration|supabase|rls|rpc|schema/)) {
    commands.splice(-1, 0, "npm run db:validate-migrations");
  }

  if (isMatch(haystack, /visible ui|route|page|screen|component|mobile|responsive|layout|browser|screenshot/)) {
    commands.push("Browser verification for changed routes at desktop and mobile widths");
  }

  return commands;
}

function summarizePreflight(issue) {
  const commandArgs = ["scripts/agent-preflight.mjs"];
  if (issue?.number) commandArgs.push("--issue", String(issue.number));
  const result = run(process.execPath, commandArgs);
  const warnings = result.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("- "))
    .filter((line) => !line.startsWith("- Worktree:") && !line.startsWith("- Branch:") && !line.startsWith("- Issue/PR:"));
  return {
    status: result.ok ? "passed" : "failed",
    warnings,
  };
}

const issue = issueNumber
  ? runJson("gh", ["issue", "view", issueNumber, "--json", "number,title,url,state,labels,body,comments,projectItems,assignees"])
  : null;
const linkedPrs = issue?.number
  ? runJson("gh", [
      "pr",
      "list",
      "--state",
      "all",
      "--search",
      `${issue.number} in:body repo:ethtri/bloomjoy-hub`,
      "--json",
      "number,title,state,url,headRefName,baseRefName,isDraft,updatedAt",
    ]) ?? []
  : [];

const gitRoot = run("git", ["rev-parse", "--show-toplevel"]).stdout || "(unknown)";
const branch = run("git", ["branch", "--show-current"]).stdout || "(unknown)";
const status = run("git", ["status", "--short"]).stdout;
const changedCount = status ? status.split(/\r?\n/).filter(Boolean).length : 0;
const preflight = summarizePreflight(issue);
const docs = buildDocList(issue);
const verification = buildVerification(issue);

console.log("# Agent Context\n");
console.log(`Generated from: ${path.basename(gitRoot)} on branch \`${branch}\``);
console.log(`Worktree: \`${gitRoot}\``);
console.log(`Git status: ${changedCount ? `${changedCount} changed file(s)` : "clean"}`);
console.log(`Preflight: ${preflight.status}`);
for (const warning of preflight.warnings) console.log(`Preflight warning: ${warning.slice(2)}`);

console.log("\n## Active Work\n");
if (issue) {
  console.log(`- Issue: #${issue.number} ${issue.title}`);
  console.log(`- URL: ${issue.url}`);
  console.log(`- State: ${issue.state}`);
  console.log(`- Labels: ${labelNames(issue)}`);
  console.log(`- Project: ${projectStatus(issue)}`);
  console.log(`- Assignees: ${issue.assignees?.map((assignee) => assignee.login).join(", ") || "none"}`);
  if (issue.body) {
    console.log("\n### Issue Body\n");
    console.log(truncate(issue.body));
  }
} else {
  console.log("- No issue found. Pass `--issue <number>` or set `AGENT_ISSUE` for issue-scoped context.");
}

console.log("\n## Linked PRs\n");
if (linkedPrs.length) {
  for (const pr of linkedPrs) {
    const draft = pr.isDraft ? "draft" : "ready";
    console.log(`- #${pr.number} ${pr.title} (${pr.state}, ${draft}) ${pr.url}`);
  }
} else {
  console.log("- None found from issue-number search.");
}

const recentComments = issue?.comments?.slice(-3) ?? [];
if (recentComments.length) {
  console.log("\n## Recent Issue Comments\n");
  for (const comment of recentComments) {
    console.log(`### ${comment.author?.login ?? "unknown"} at ${comment.createdAt}`);
    console.log(truncate(comment.body, 700));
    console.log("");
  }
}

console.log("\n## Read Next\n");
for (const doc of docs) console.log(`- ${doc}`);

console.log("\n## Verification Profile\n");
for (const command of verification) console.log(`- ${command}`);

console.log("\n## Goal Seed\n");
if (issue) {
  console.log(`/goal Issue: #${issue.number} Outcome: ${issue.title}`);
  console.log("Acceptance criteria: use the issue body and comments; keep closeout evidence in the PR and issue.");
} else {
  console.log("/goal Issue: #___ Outcome: <fill from GitHub issue>");
}

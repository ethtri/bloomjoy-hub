#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const prNumber = args.pr || process.env.AGENT_PR || "";
const repo = args.repo || process.env.AGENT_REPO || "ethtri/bloomjoy-hub";

const executiveDecisionLabels = new Set(["blocked-external", "needs-owner-decision"]);
const unresolvedBlockerLabels = new Set(["blocked"]);
const highRiskTechnicalLabels = new Set(["risky-auth-payment", "risky-db-change"]);
const uatEvidenceLabels = new Set(["uat-required"]);

const yellowLabels = new Set([
  "P0",
  "P1",
  "ui-change",
  ...highRiskTechnicalLabels,
  ...uatEvidenceLabels,
]);

const passingConclusions = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const failures = [];
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

function runJson(command, commandArgs) {
  const stdout = execFileSync(command, commandArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return stdout ? JSON.parse(stdout) : null;
}

function runJsonOrNull(command, commandArgs) {
  try {
    return runJson(command, commandArgs);
  } catch {
    return null;
  }
}

function sectionText(markdown, heading) {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*\\r?\\n([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, "im");
  const match = String(markdown ?? "").match(pattern);
  return match?.[1]?.trim() ?? "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isSubstantive(value) {
  const text = String(value ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/[_`*\-\[\]\s]/g, "")
    .trim();
  return text.length >= 12 && !/^(tbd|na|none|notapplicable)$/i.test(text);
}

function linkedIssueNumbers(body) {
  const numbers = new Set();
  const text = String(body ?? "");
  const linkedIssueSection = sectionText(text, "Linked Issue") || sectionText(text, "Linked issue");
  const source = linkedIssueSection || text;
  const regex = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|issue|linked issue)?\s*#(\d+)/gi;
  let match;
  while ((match = regex.exec(source))) numbers.add(match[1]);
  return [...numbers];
}

function issueLabels(issueNumber) {
  const issue = runJsonOrNull("gh", [
    "issue",
    "view",
    issueNumber,
    "--repo",
    repo,
    "--json",
    "labels,state,title,url",
  ]);
  return issue?.labels?.map((label) => label.name) ?? [];
}

function collectLabels(pr) {
  const labels = new Set(pr.labels?.map((label) => label.name) ?? []);
  for (const issueNumber of linkedIssueNumbers(pr.body)) {
    for (const label of issueLabels(issueNumber)) labels.add(label);
  }
  return [...labels];
}

function checkStatusRollup(items) {
  if (!items?.length) {
    failures.push("No status checks were found on the PR.");
    return;
  }

  for (const item of items) {
    const name = item.name || item.context || "(unnamed check)";

    if (item.__typename === "StatusContext") {
      if (item.state !== "SUCCESS") {
        failures.push(`Status '${name}' is ${item.state || "unknown"}, not SUCCESS.`);
      }
      continue;
    }

    if (item.status !== "COMPLETED") {
      failures.push(`Check '${name}' is ${item.status || "unknown"}, not COMPLETED.`);
      continue;
    }

    if (!passingConclusions.has(item.conclusion)) {
      failures.push(`Check '${name}' concluded ${item.conclusion || "unknown"}.`);
    }
  }
}

function claimedLane(body) {
  const autonomy = sectionText(body, "Merge Autonomy");
  const match = autonomy.match(/lane\s*:\s*(green|yellow|red)/i);
  return match?.[1]?.toLowerCase() ?? "";
}

function executiveDecisionRequired(body) {
  const autonomy = sectionText(body, "Merge Autonomy");
  return /(?:owner approval|executive decision)\s*:\s*required/i.test(autonomy);
}

function laneFromLabels(labels) {
  if (labels.some((label) => executiveDecisionLabels.has(label) || unresolvedBlockerLabels.has(label))) return "red";
  if (labels.some((label) => yellowLabels.has(label))) return "yellow";
  return "green";
}

function labelsIn(labels, labelSet) {
  return labels.filter((label) => labelSet.has(label));
}

function summarize(labels, lane) {
  console.log("Agent merge gate");
  console.log(`- PR: #${pr.number} ${pr.title}`);
  console.log(`- URL: ${pr.url}`);
  console.log(`- Base: ${pr.baseRefName}`);
  console.log(`- State: ${pr.state}${pr.isDraft ? " (draft)" : ""}`);
  console.log(`- Mergeability: ${pr.mergeable} / ${pr.mergeStateStatus}`);
  console.log(`- Labels considered: ${labels.length ? labels.join(", ") : "none"}`);
  console.log(`- Inferred lane: ${lane.toUpperCase()}`);
}

if (!prNumber) {
  console.error("Usage: npm run agent:merge-gate -- --pr <number>");
  process.exit(1);
}

const pr = runJson("gh", [
  "pr",
  "view",
  prNumber,
  "--repo",
  repo,
  "--json",
  "number,title,url,state,isDraft,baseRefName,headRefName,mergeable,mergeStateStatus,labels,statusCheckRollup,body,reviewDecision",
]);

const labels = collectLabels(pr);
const inferredLane = laneFromLabels(labels);
const laneClaim = claimedLane(pr.body);
const linkedIssues = linkedIssueNumbers(pr.body);
const verification = sectionText(pr.body, "Verification");
const risk = sectionText(pr.body, "Risk And Overlap") || sectionText(pr.body, "Risk and overlap");
const designEvidence = sectionText(pr.body, "UI / Design Evidence");
const reviewEvidence =
  sectionText(pr.body, "Independent Review / QA Evidence") ||
  sectionText(pr.body, "Independent Review") ||
  sectionText(pr.body, "Review / QA Evidence");
const howToTest = sectionText(pr.body, "How To Test Locally") || sectionText(pr.body, "How To Test");
const autonomy = sectionText(pr.body, "Merge Autonomy");
const executiveLabels = labelsIn(labels, executiveDecisionLabels);
const unresolvedBlockerLabelHits = labelsIn(labels, unresolvedBlockerLabels);
const highRiskTechnicalLabelHits = labelsIn(labels, highRiskTechnicalLabels);
const uatEvidenceLabelHits = labelsIn(labels, uatEvidenceLabels);
const isDependabot = pr.headRefName?.startsWith("dependabot/");

summarize(labels, inferredLane);

if (pr.state !== "OPEN") failures.push(`PR state is ${pr.state}, not OPEN.`);
if (pr.isDraft) failures.push("PR is still a draft.");
if (pr.baseRefName !== "main") failures.push("Agent merge autonomy only applies to PRs targeting main.");
if (pr.reviewDecision === "CHANGES_REQUESTED") failures.push("A review requested changes on this PR.");
if (pr.mergeable !== "MERGEABLE") failures.push(`GitHub reports mergeable=${pr.mergeable}.`);
if (!["CLEAN", "HAS_HOOKS"].includes(pr.mergeStateStatus)) {
  failures.push(`GitHub reports mergeStateStatus=${pr.mergeStateStatus}. Re-check after GitHub recalculates or update the branch.`);
}

checkStatusRollup(pr.statusCheckRollup);

if (!linkedIssues.length && !isDependabot) failures.push("PR body does not link a GitHub issue.");
if (!isSubstantive(verification)) failures.push("PR body needs substantive verification results.");
if (!isSubstantive(risk)) failures.push("PR body needs a substantive Risk And Overlap section.");
if (!isSubstantive(autonomy)) failures.push("PR body needs a substantive Merge Autonomy section.");

if (executiveLabels.length) {
  failures.push(`Executive decision label(s) present: ${executiveLabels.join(", ")}. Owner direction is required; do not agent-merge.`);
}

if (unresolvedBlockerLabelHits.length) {
  failures.push(`Unresolved blocker label(s) present: ${unresolvedBlockerLabelHits.join(", ")}. Remove the blocker or document resolution before merge.`);
}

if (!laneClaim) {
  failures.push("Merge Autonomy section must include 'Lane: Green', 'Lane: Yellow', or 'Lane: Red'.");
} else if (inferredLane === "yellow" && laneClaim === "green") {
  failures.push("PR claims Green lane, but labels require Yellow lane evidence.");
} else if (laneClaim === "red") {
  failures.push("PR claims Red lane. Reclassify only after executive/blocker status is resolved, or wait for owner direction.");
}

if (executiveDecisionRequired(pr.body) && !executiveLabels.length) {
  failures.push("PR says an executive decision is required without an executive decision label. Reclassify or document the executive blocker before merge.");
}

if (labels.includes("ui-change") && !isSubstantive(designEvidence)) {
  failures.push("ui-change PRs need substantive UI / Design Evidence.");
}

if (highRiskTechnicalLabelHits.length && !isSubstantive(reviewEvidence)) {
  failures.push(
    `${highRiskTechnicalLabelHits.join(", ")} PRs need substantive Independent Review / QA Evidence before agent merge.`,
  );
}

if (uatEvidenceLabelHits.length && !isSubstantive(howToTest)) {
  failures.push(`${uatEvidenceLabelHits.join(", ")} PRs need substantive UAT or How To Test evidence before agent merge.`);
}

if (labels.includes("P0") || labels.includes("P1")) {
  warnings.push("P0/P1 priority detected. Confirm the PR evidence proves it is not executive-blocked before merge.");
}

if (isDependabot) {
  warnings.push("Dependabot branch detected. A linked issue is optional, but local verification and merge-autonomy evidence are still required.");
}

if (warnings.length) {
  console.log("\nWarnings");
  for (const warning of warnings) console.log(`- ${warning}`);
}

if (failures.length) {
  console.error("\nMerge gate blocked");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("\nMerge gate passed.");

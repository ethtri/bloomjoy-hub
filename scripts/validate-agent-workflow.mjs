#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const trackedFiles = new Set(
  execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean),
);

function resolve(filePath) {
  return path.join(root, filePath);
}

function exists(filePath) {
  return existsSync(resolve(filePath));
}

function read(filePath) {
  return readFileSync(resolve(filePath), "utf8");
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function assertFile(filePath) {
  assert(exists(filePath), `Missing required file: ${filePath}`);
}

const requiredFiles = [
  ".codex/config.toml",
  ".codex/agents/repo-mapper.toml",
  ".codex/agents/qa-challenger.toml",
  ".codex/agents/design-reviewer.toml",
  ".codex/agents/docs-researcher.toml",
  ".codex/agents/security-risk-reviewer.toml",
  ".agents/skills/bloomjoy-agent-workflow/SKILL.md",
  ".agents/skills/bloomjoy-agent-workflow/agents/openai.yaml",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/feature_task.yml",
  ".github/ISSUE_TEMPLATE/bug.yml",
  "scripts/agent-preflight.mjs",
  "scripts/agent-context.mjs",
  "scripts/agent-github-hygiene.mjs",
  "scripts/agent-worktree-hygiene.mjs",
  "scripts/agent-merge-gate.mjs",
  "scripts/validate-agent-workflow.mjs",
  "Docs/REFUND_WORKFLOW.md",
];

for (const file of requiredFiles) assertFile(file);

const retiredRefundContext = [
  "Docs/MACHINE_MANAGER_SHADOW_UAT_SCRIPT.md",
  "Docs/NAYAX_REFUND_PRODUCTION_RCA.md",
  "Docs/REFUND_EMAIL_PILOT_DEMO_PACKET.md",
  "Docs/REFUND_EMAIL_PILOT_SPONSOR_REVIEW.md",
  "Docs/REFUND_EMAIL_PILOT_UAT_SCRIPT.md",
  "Docs/REFUND_FULL_AUTOMATION_GO_NO_GO.md",
  "Docs/REFUND_GMAIL_INTAKE_SHADOW_RUNBOOK.md",
  "Docs/REFUND_HISTORICAL_OWNER_NOTICE.md",
  "Docs/REFUND_IDENTIFICATION_STRATEGY.md",
  "Docs/REFUND_LEGACY_MACHINE_CORRECTION.md",
  "Docs/REFUND_MVP_PLAN.md",
  "Docs/REFUND_NAYAX_CONTROLLED_OWNER_PILOT.md",
  "Docs/REFUND_OPERATIONS_SHADOW_PILOT.md",
  "Docs/REFUND_PRODUCTION_CUTOVER_PACKET.md",
  "Docs/REFUND_PRODUCTION_POLICY.md",
  "Docs/REFUND_PRODUCTION_SHADOW_SETUP.md",
  "Docs/REFUND_SIMPLE_JOURNEY_RELEASE_RUNBOOK.md",
  "scripts/refunds/validate-nayax-controlled-owner-pilot-runner.mjs",
  "scripts/refunds/validate-refund-email-pilot.mjs",
  "scripts/refunds/validate-refund-gmail-intake-shadow-runner.mjs",
  "scripts/refunds/validate-refund-synthetic-gmail-proof-runner.mjs",
  "scripts/refunds/refund-owner-totp-auth-readiness.mjs",
  "scripts/refunds/validate-refund-production-auth-gate.mjs",
  "scripts/refunds/validate-refund-manager-mfa-freshness.mjs",
];

for (const file of retiredRefundContext) {
  assert(!exists(file), `Retired refund context must stay removed: ${file}`);
}

assert(!trackedFiles.has(".github/pull_request_template.md"), "Old lowercase PR template should not be tracked.");
assert(!trackedFiles.has(".github/ISSUE_TEMPLATE/ai_task.md"), "Old markdown AI task issue template should not be tracked.");
assert(!trackedFiles.has(".github/ISSUE_TEMPLATE/bug_report.md"), "Old markdown bug issue template should not be tracked.");

if (exists(".codex/config.toml")) {
  const config = read(".codex/config.toml");
  assert(/\[agents\]/.test(config), ".codex/config.toml must keep global [agents] settings.");
  assert(/max_threads\s*=\s*6/.test(config), ".codex/config.toml must set agents.max_threads = 6.");
  assert(/max_depth\s*=\s*1/.test(config), ".codex/config.toml must set agents.max_depth = 1.");
  assert(!/\[agents\."/m.test(config), "Custom agents must live in .codex/agents/*.toml, not nested under [agents.*].");
}

const expectedAgents = new Map([
  [".codex/agents/repo-mapper.toml", "repo_mapper"],
  [".codex/agents/qa-challenger.toml", "qa_challenger"],
  [".codex/agents/design-reviewer.toml", "design_reviewer"],
  [".codex/agents/docs-researcher.toml", "docs_researcher"],
  [".codex/agents/security-risk-reviewer.toml", "security_risk_reviewer"],
]);

for (const [file, name] of expectedAgents) {
  if (!exists(file)) continue;
  const source = read(file);
  assert(new RegExp(`name\\s*=\\s*"${name}"`).test(source), `${file} must define name = "${name}".`);
  assert(/description\s*=\s*"/.test(source), `${file} must define description.`);
  assert(/developer_instructions\s*=\s*"""/.test(source), `${file} must define developer_instructions.`);
  assert(/sandbox_mode\s*=\s*"read-only"/.test(source), `${file} must be read-only.`);
  assert(!/prompt\s*=/.test(source), `${file} should use developer_instructions, not prompt.`);
}

if (exists(".agents/skills/bloomjoy-agent-workflow/SKILL.md")) {
  const skill = read(".agents/skills/bloomjoy-agent-workflow/SKILL.md");
  assert(/^---\r?\nname: bloomjoy-agent-workflow\r?\ndescription: /m.test(skill), "Bloomjoy workflow skill must define name and description frontmatter.");
  assert(!/\[TODO|TODO:/i.test(skill), "Bloomjoy workflow skill must not contain template TODO text.");
  assert(/npm run agent:context/.test(skill), "Bloomjoy workflow skill should point agents to the context command.");
}

if (exists("scripts/agent-context.mjs")) {
  const agentContext = read("scripts/agent-context.mjs");
  assert(
    agentContext.includes('"Docs/CURRENT_STATUS.md"'),
    "Agent context must always route agents through Docs/CURRENT_STATUS.md.",
  );
  assert(
    /if \(isMatch\(haystack, \/refund\|nayax\/\)\) \{[\s\S]*?Docs\/REFUND_WORKFLOW\.md/.test(agentContext),
    "Refund or Nayax context must route agents through Docs/REFUND_WORKFLOW.md.",
  );
  assert(
    /if \(isMatch\(haystack, \/refund\|nayax\/\)\) \{[\s\S]*?Docs\/REFUND_AGENT_OPERATIONS\.md/.test(agentContext),
    "Refund or Nayax context must route agents through Docs/REFUND_AGENT_OPERATIONS.md.",
  );
  assert(
    exists("Docs/NAYAX_REFUND_WORKING_CONTRACT.md") &&
      agentContext.includes('docs.add("Docs/NAYAX_REFUND_WORKING_CONTRACT.md")') &&
      read("AGENTS.md").includes("Docs/NAYAX_REFUND_WORKING_CONTRACT.md"),
    "Refund agents must discover the verified working API contract from both instructions and generated context.",
  );
}

if (exists("Docs/REFUND_WORKFLOW.md")) {
  const refundWorkflow = read("Docs/REFUND_WORKFLOW.md");
  assert(
    /least 95% of ordinary valid cases/i.test(refundWorkflow) &&
      /recommendation is advisory/i.test(refundWorkflow),
    "Refund workflow must preserve the automation target and Manager override.",
  );
  assert(
    /full amount actually charged/i.test(refundWorkflow) &&
      /including sales tax/i.test(refundWorkflow),
    "Refund workflow must default to the full charged total including sales tax.",
  );
  assert(
    /Confirm refund sent via Zelle/i.test(refundWorkflow) &&
      /There is no separate `approved for payout`/i.test(refundWorkflow),
    "Refund workflow must keep cash completion to one post-Zelle confirmation.",
  );
  assert(
    /send one follow-up/i.test(refundWorkflow) &&
      /Close the case after 30 days/i.test(refundWorkflow),
    "Refund workflow must preserve the single follow-up and 30-day closure policy.",
  );
  assert(
    !/exact customer-amount matching is required/i.test(refundWorkflow),
    "Refund workflow must not restore exact customer-amount matching.",
  );
}

if (exists("package.json")) {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.scripts?.["agent:preflight"], "package.json must include agent:preflight.");
  assert(pkg.scripts?.["agent:context"], "package.json must include agent:context.");
  assert(pkg.scripts?.["agent:github-hygiene"], "package.json must include agent:github-hygiene.");
  assert(pkg.scripts?.["agent:worktree-hygiene"], "package.json must include agent:worktree-hygiene.");
  assert(pkg.scripts?.["agent:merge-gate"], "package.json must include agent:merge-gate.");
  assert(pkg.scripts?.["agent:validate-workflow"], "package.json must include agent:validate-workflow.");
  assert(!pkg.scripts?.["refunds:synthetic-gmail-proof"], "Retired synthetic Gmail proof ceremony must not be a package command.");
  assert(!pkg.scripts?.["refunds:gmail-intake-shadow"], "Retired Gmail shadow ceremony must not be a package command.");
  assert(!pkg.scripts?.["refunds:validate-email-pilot"], "Retired email-pilot validator must not be a package command.");
  assert(!pkg.scripts?.["refunds:validate-manager-totp"], "Retired routine TOTP validator must not be a package command.");
  assert(!pkg.scripts?.["refunds:production-auth-closed"], "Retired Auth ceremony must not be a package command.");
  assert(!pkg.scripts?.["refunds:validate-production-auth-gate"], "Retired Auth-ceremony validator must not be a package command.");
  assert(!pkg.scripts.test.includes("refunds:validate-uat-evidence"), "The standard test profile must not impose a fixed refund screenshot ceremony.");
}

if (exists(".github/workflows/ci.yml")) {
  const ci = read(".github/workflows/ci.yml");
  assert(/npm run agent:validate-workflow/.test(ci), "CI must run npm run agent:validate-workflow.");
}

for (const file of [".github/ISSUE_TEMPLATE/feature_task.yml", ".github/ISSUE_TEMPLATE/bug.yml"]) {
  if (!exists(file)) continue;
  const source = read(file);
  assert(/^name:/m.test(source), `${file} must define name.`);
  assert(/^body:/m.test(source), `${file} must define body.`);
  assert(/Executive decision and risk triggers/.test(source), `${file} must include executive decision and risk triggers.`);
  assert(/Sensitive data warning/.test(source), `${file} must include sensitive data warning.`);
  assert(/Expected verification/.test(source), `${file} must include expected verification.`);
}

if (exists(".github/PULL_REQUEST_TEMPLATE.md")) {
  const prTemplate = read(".github/PULL_REQUEST_TEMPLATE.md");
  assert(/Merge Autonomy/.test(prTemplate), "PR template must include Merge Autonomy.");
  assert(/agent:merge-gate/.test(prTemplate), "PR template must mention npm run agent:merge-gate.");
}

const hygieneDocs = [
  "AGENTS.md",
  "Docs/LOCAL_DEV.md",
  "Docs/AI_WORKFLOW.md",
  "Docs/AGENT_SPRINT_WORKFLOW.md",
  ".agents/skills/bloomjoy-agent-workflow/SKILL.md",
];

for (const file of hygieneDocs) {
  if (!exists(file)) continue;
  const source = read(file);
  assert(/agent:github-hygiene/.test(source), `${file} must mention npm run agent:github-hygiene.`);
  assert(/agent:worktree-hygiene/.test(source), `${file} must mention npm run agent:worktree-hygiene.`);
}

const mergeAutonomyDocs = [
  "AGENTS.md",
  "Docs/AI_WORKFLOW.md",
  "Docs/LOCAL_DEV.md",
  "Docs/AGENT_SPRINT_WORKFLOW.md",
  ".agents/skills/bloomjoy-agent-workflow/SKILL.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
];

for (const file of mergeAutonomyDocs) {
  if (!exists(file)) continue;
  const source = read(file);
  assert(/executive decision/i.test(source), `${file} must reserve owner approval for executive decisions.`);
  assert(/proactive/i.test(source), `${file} must describe proactive PR closeout or merge responsibility.`);
}

const workflowDocs = [
  "AGENTS.md",
  "Docs/README.md",
  "Docs/TASK_TEMPLATE.md",
  "Docs/AGENT_SPRINT_WORKFLOW.md",
  "Docs/AI_WORKFLOW.md",
  "Docs/LOCAL_DEV.md",
  "Docs/PR_TEMPLATE.md",
];

for (const file of workflowDocs) {
  if (!exists(file)) continue;
  const source = read(file);
  assert(!/\.github\/ISSUE_TEMPLATE\/ai_task\.md/.test(source), `${file} must not reference the retired AI task template.`);
  assert(!/\.github\/ISSUE_TEMPLATE\/bug_report\.md/.test(source), `${file} must not reference the retired bug report template.`);
  assert(!/Docs\/BACKLOG\.md`?\s+(?:as|is)\s+(?:the\s+)?(?:active|canonical|source of truth)/i.test(source), `${file} must not treat Docs/BACKLOG.md as active source of truth.`);
}

if (failures.length) {
  console.error("Agent workflow validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Agent workflow validation passed.");

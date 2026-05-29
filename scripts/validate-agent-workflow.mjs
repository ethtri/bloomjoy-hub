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
  "scripts/validate-agent-workflow.mjs",
];

for (const file of requiredFiles) assertFile(file);

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

if (exists("package.json")) {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.scripts?.["agent:preflight"], "package.json must include agent:preflight.");
  assert(pkg.scripts?.["agent:context"], "package.json must include agent:context.");
  assert(pkg.scripts?.["agent:validate-workflow"], "package.json must include agent:validate-workflow.");
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
  assert(/Sensitive data warning/.test(source), `${file} must include sensitive data warning.`);
  assert(/Expected verification/.test(source), `${file} must include expected verification.`);
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

#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const forbiddenRoot = path.normalize("C:\\Repos\\Bloomjoy_hub").toLowerCase();
const failures = [];
const warnings = [];

function runGit(args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function normalizePath(value) {
  return path.normalize(value).toLowerCase();
}

function readArgValue(name) {
  const equalsPrefix = `${name}=`;
  const equalsArg = process.argv.slice(2).find((arg) => arg.startsWith(equalsPrefix));
  if (equalsArg) return equalsArg.slice(equalsPrefix.length);

  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];

  return "";
}

let root = "";
let branch = "";
let status = "";

try {
  root = realpathSync(runGit(["rev-parse", "--show-toplevel"]));
} catch {
  failures.push("This directory is not inside a Git worktree.");
}

if (root) {
  const normalizedRoot = normalizePath(root);
  if (normalizedRoot === forbiddenRoot) {
    failures.push("You are in C:\\Repos\\Bloomjoy_hub. Switch to a dedicated C:\\Repos\\wt-<task> worktree before editing.");
  }

  if (!path.basename(root).toLowerCase().startsWith("wt-")) {
    warnings.push(`Worktree folder is '${root}', not the usual C:\\Repos\\wt-<task> shape.`);
  }
}

try {
  branch = runGit(["branch", "--show-current"]);
  if (!branch.startsWith("agent/")) {
    failures.push(`Current branch '${branch || "(detached)"}' does not start with agent/.`);
  }
} catch {
  failures.push("Could not read the current Git branch.");
}

try {
  status = runGit(["status", "--short"]);
  if (status) {
    const fileCount = status.split(/\r?\n/).filter(Boolean).length;
    warnings.push(`Working tree has ${fileCount} changed file(s). Review git status before committing.`);
  }
} catch {
  failures.push("Could not read git status.");
}

try {
  const remotes = runGit(["remote", "-v"]);
  if (!remotes.includes("github.com/ethtri/bloomjoy-hub")) {
    warnings.push("Git remote does not look like ethtri/bloomjoy-hub.");
  }
} catch {
  warnings.push("Could not read git remotes.");
}

const issue = readArgValue("--issue") || process.env.AGENT_ISSUE || "";
const pr = readArgValue("--pr") || process.env.AGENT_PR || "";
if (!issue && !pr) {
  warnings.push("Issue/PR linkage is pending. Pass --issue <number>, --pr <number>, or set AGENT_ISSUE/AGENT_PR when available.");
}

console.log("Agent preflight");
console.log(`- Worktree: ${root || "(unknown)"}`);
console.log(`- Branch: ${branch || "(unknown)"}`);
console.log(`- Issue/PR: ${issue || pr || "pending"}`);

if (warnings.length) {
  console.log("\nWarnings");
  for (const warning of warnings) console.log(`- ${warning}`);
}

if (failures.length) {
  console.error("\nFailures");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("\nPreflight passed.");

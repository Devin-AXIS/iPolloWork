#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const RUNTIME_EXTENSIONS = new Set([".mp3", ".wav", ".aac", ".m4a", ".mp4", ".webm", ".mov", ".avi", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".zip"]);
const RUNTIME_DIR_PATTERN = /(^|\/)(generated|outputs?|uploads?|captures?|renders?|exports?|temp|tmp)(\/|$)/i;
const IGNORED_DUPLICATE_NAMES = new Set(["index.ts", "index.tsx", "types.ts", "constants.ts", "utils.ts"]);
const FORBIDDEN_DIRECTORY_NAMES = new Set(["backup", "backups", "copy", "copies", "draft", "drafts", "handoff", "handoffs", "misc", "notes", "old", "scratch", "temp", "tmp", "tdd-summary", "untitled"]);
const ROOT_DOCUMENT_PATTERN = /^(AGENTS|CODE_OF_CONDUCT|CONTRIBUTING|LICENSE|NOTICE|README|SECURITY|SUPPORT)(?:[._-].*)?$/i;
const ROOT_CONFIGURATION_PATTERN = /^(biome\.jsonc?|components\.json|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig(?:\.[^.]+)?\.json)$/i;
const VERSION_COPY_NAME_PATTERN = /(?:^|[-_.])(copy|final|new|old|v2)(?:[-_.]|$)/i;
const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const LARGE_NEW_SOURCE_LINES = 400;

function git(args, allowFailure = false) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0 && !allowFailure) throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  return result.status === 0 ? result.stdout.trim() : "";
}

const lines = (value) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const normalize = (path) => path.replaceAll("\\", "/");
const unique = (values) => [...new Set(values)];
const root = git(["rev-parse", "--show-toplevel"]);
process.chdir(root);

const changed = unique([
  ...lines(git(["diff", "--name-only", "--diff-filter=ACMR", "HEAD"], true)),
  ...lines(git(["ls-files", "--others", "--exclude-standard"], true)),
]).map(normalize).filter((path) => existsSync(path) && statSync(path).isFile());
const added = new Set(unique([
  ...lines(git(["diff", "--name-only", "--diff-filter=A", "HEAD"], true)),
  ...lines(git(["ls-files", "--others", "--exclude-standard"], true)),
]).map(normalize));
const tracked = lines(git(["ls-files"])).map(normalize).filter((path) => existsSync(path));
const baselineDirectories = new Set(lines(git(["ls-tree", "-d", "-r", "--name-only", "HEAD"], true)).map(normalize));
const baselineTopLevelDirectories = new Set(lines(git(["ls-tree", "-d", "--name-only", "HEAD"], true)).map(normalize));
const errors = [];
const warnings = [];

function report(collection, rule, file, message, related = []) {
  collection.push({ rule, file, message, ...(related.length ? { related } : {}) });
}

function parseJson(value, file, revision) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch (error) {
    report(errors, "invalid-package-json", file, `Cannot inspect ${revision} package manifest: ${error.message}`);
    return {};
  }
}

const addedFiles = [...added].filter((path) => existsSync(path) && statSync(path).isFile());
const addedByParent = new Map();
const reportedTopLevelDirectories = new Set();

for (const file of addedFiles) {
  const parts = file.split("/");
  const directories = parts.slice(0, -1);
  const parent = directories.join("/");
  if (parent) addedByParent.set(parent, [...(addedByParent.get(parent) || []), file]);

  const topLevel = directories[0];
  if (topLevel && !baselineTopLevelDirectories.has(topLevel) && !reportedTopLevelDirectories.has(topLevel)) {
    reportedTopLevelDirectories.add(topLevel);
    report(errors, "new-top-level-directory", file, `New top-level directory '${topLevel}' requires explicit user approval and a repository-level owner.`);
  }

  for (const directory of directories) {
    const name = basename(directory).toLowerCase();
    if (FORBIDDEN_DIRECTORY_NAMES.has(name)) {
      report(errors, "junk-directory-name", file, `Directory '${name}' hides ownership. Extend a named existing owner instead.`);
      break;
    }
  }

  if (parts.length === 1 && !ROOT_DOCUMENT_PATTERN.test(file) && !ROOT_CONFIGURATION_PATTERN.test(file)) {
    report(extname(file).toLowerCase() === ".md" ? errors : warnings, "new-root-file", file, "Do not add a one-off repository-root file; use an existing owner or justify a repository-standard root entry.");
  }

  if (SOURCE_EXTENSIONS.has(extname(file).toLowerCase())) {
    const lineCount = readFileSync(file, "utf8").split(/\r?\n/).length;
    if (lineCount > LARGE_NEW_SOURCE_LINES) {
      report(warnings, "large-new-source-file", file, `New source has ${lineCount} lines; verify it is one coherent owner rather than a bundled subsystem.`);
    }
    if (VERSION_COPY_NAME_PATTERN.test(basename(file))) {
      report(warnings, "version-copy-source-name", file, "Integrate with the canonical implementation instead of introducing a new/old/v2/copy/final variant.");
    }
  }
}

for (const [directory, files] of addedByParent) {
  if (!baselineDirectories.has(directory) && files.length === 1) {
    report(warnings, "single-file-directory", files[0], `New directory '${directory}' contains one changed file; keep it in an existing owner unless the directory has a durable multi-file lifecycle.`);
  }
}

for (const file of changed.filter((path) => basename(path) === "package.json")) {
  const before = parseJson(git(["show", `HEAD:${file}`], true), file, "HEAD");
  const after = parseJson(readFileSync(file, "utf8"), file, "working tree");
  for (const section of DEPENDENCY_SECTIONS) {
    const previousDependencies = before[section] || {};
    const nextDependencies = after[section] || {};
    for (const dependency of Object.keys(nextDependencies)) {
      if (!(dependency in previousDependencies)) {
        report(warnings, "new-dependency", file, `New ${section} entry '${dependency}' requires a reuse, bundle/runtime cost, maintenance, and license justification.`);
      }
    }
  }
}

for (const file of changed) {
  const extension = extname(file).toLowerCase();
  if (file.startsWith("apps/server/src/") && (RUNTIME_EXTENSIONS.has(extension) || RUNTIME_DIR_PATTERN.test(file))) {
    report(errors, "runtime-artifact-in-source", file, "Runtime artifacts must use the owning workspace session directory, not apps/server/src.");
  }
  if (!SOURCE_EXTENSIONS.has(extension)) continue;
  const content = readFileSync(file, "utf8");
  const domainMatch = file.match(/^apps\/app\/src\/react-app\/domains\/([^/]+)\//);
  if (!domainMatch) continue;
  const owner = domainMatch[1];
  for (const match of content.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)) {
    const specifier = match[1];
    let target = "";
    if (specifier.startsWith(".")) target = normalize(resolve(dirname(resolve(root, file)), specifier)).slice(normalize(root).length + 1);
    if (specifier.startsWith("@/react-app/domains/")) target = specifier.slice(2);
    const targetMatch = target.match(/^react-app\/domains\/([^/]+)\//) || target.match(/^apps\/app\/src\/react-app\/domains\/([^/]+)\//);
    if (targetMatch && targetMatch[1] !== owner) report(warnings, "cross-domain-private-import", file, `Domain '${owner}' imports private code from '${targetMatch[1]}'.`, [specifier]);
  }
}

const existingSource = tracked.filter((path) => SOURCE_EXTENSIONS.has(extname(path).toLowerCase()));
const hashToFiles = new Map();
for (const file of existingSource) {
  if (added.has(file)) continue;
  const content = readFileSync(file, "utf8").trim();
  if (content.length < 80) continue;
  const hash = createHash("sha256").update(content).digest("hex");
  hashToFiles.set(hash, [...(hashToFiles.get(hash) || []), file]);
}

for (const file of changed.filter((path) => added.has(path) && SOURCE_EXTENSIONS.has(extname(path).toLowerCase()))) {
  const content = readFileSync(file, "utf8").trim();
  if (content.length >= 80) {
    const duplicates = hashToFiles.get(createHash("sha256").update(content).digest("hex")) || [];
    if (duplicates.length) report(errors, "exact-source-duplicate", file, "New source is identical to existing source; reuse the existing implementation.", duplicates);
  }
  const name = basename(file);
  if (!IGNORED_DUPLICATE_NAMES.has(name)) {
    const sameNames = existingSource.filter((candidate) => basename(candidate) === name && candidate !== file);
    if (sameNames.length) report(warnings, "duplicate-source-filename", file, "A source file with the same name already exists; verify distinct ownership.", sameNames.slice(0, 8));
  }
  const exported = unique([...content.matchAll(/\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)].map((match) => match[1]).filter((name) => /^[A-Z]|^use[A-Z]/.test(name)));
  for (const symbol of exported) {
    const pattern = new RegExp(`\\bexport\\s+(?:default\\s+)?(?:async\\s+)?(?:function|class|const|let|var|type|interface|enum)\\s+${symbol}\\b`);
    const matches = existingSource.filter((candidate) => pattern.test(readFileSync(candidate, "utf8")));
    if (matches.length) report(warnings, "duplicate-export-name", file, `New export '${symbol}' already exists.`, matches.slice(0, 8));
  }
}

console.log(JSON.stringify({ ok: errors.length === 0, root, checkedFiles: changed.length, errors, warnings }, null, 2));
process.exitCode = errors.length ? 1 : 0;

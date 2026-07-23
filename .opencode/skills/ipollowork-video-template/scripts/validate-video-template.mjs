#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ALLOWED_TYPES = new Set(["color", "font", "number", "text", "image", "boolean", "select"]);
const ALLOWED_GROUPS = new Set(["theme", "background", "typography", "components", "content", "brand"]);
const COMPOSITION_TYPE_BY_MANIFEST_TYPE = new Map([
  ["color", "color"],
  ["font", "string"],
  ["number", "number"],
  ["text", "string"],
  ["image", "string"],
  ["boolean", "boolean"],
  ["select", "string"],
]);
const ROOT_ATTRIBUTES = ["data-composition-id", "data-start", "data-width", "data-height", "data-duration"];
const CLIP_ATTRIBUTES = ["data-start", "data-duration", "data-track-index"];

const templateArgument = process.argv[2];
if (!templateArgument) {
  console.error("Usage: node validate-video-template.mjs <template-directory>");
  process.exit(2);
}

const templateDirectory = path.resolve(templateArgument);
const manifestPath = path.join(templateDirectory, "manifest.json");
const errors = [];
const warnings = [];

function error(message) {
  errors.push(message);
}

function warning(message) {
  warnings.push(message);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2];
}

function numericAttribute(tag, name, label) {
  const value = attribute(tag, name);
  const number = Number(value);
  if (value == null || !Number.isFinite(number)) {
    error(`${label} must have a finite ${name}.`);
    return null;
  }
  return number;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (cause) {
  console.error(`FAIL: cannot read valid JSON from ${manifestPath}`);
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exit(1);
}

if (manifest.schemaVersion !== 1) error("manifest.schemaVersion must be 1.");
if (manifest.kind !== "design") error('manifest.kind must be "design".');
if (manifest.category !== "video") error('manifest.category must be "video".');
if (manifest.surface !== "video") error('manifest.surface must be "video".');
if (manifest.entry !== "index.html") error('manifest.entry must be "index.html".');
if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(manifest.id ?? "")) {
  error("manifest.id must be a stable reverse-domain-style ID.");
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version ?? "")) {
  error("manifest.version must be semantic.");
}
if (!Array.isArray(manifest.applyChecklist) || manifest.applyChecklist.length === 0) {
  error("manifest.applyChecklist must contain at least one actionable item.");
}

const entryPath = path.join(templateDirectory, manifest.entry ?? "index.html");
const coverPath = path.join(templateDirectory, manifest.cover ?? "");
if (!(await exists(entryPath))) error(`Missing entry file: ${entryPath}`);
if (!manifest.cover || !(await exists(coverPath))) error(`Missing cover file: ${coverPath}`);

const variables = manifest.designSystem?.variables;
if (!Array.isArray(variables)) {
  error("manifest.designSystem.variables must be an array.");
}

const declared = new Map();
for (const variable of Array.isArray(variables) ? variables : []) {
  if (!variable || typeof variable !== "object") {
    error("Every variable must be an object.");
    continue;
  }
  const keys = Object.keys(variable);
  const unsupportedKeys = keys.filter((key) => !["id", "label", "type", "group"].includes(key));
  if (unsupportedKeys.length) {
    error(`Variable ${variable.id ?? "<unknown>"} has unsupported V1 fields: ${unsupportedKeys.join(", ")}.`);
  }
  if (!/^(?:--ipw-[a-z0-9-]+|[A-Za-z_][A-Za-z0-9_-]*)$/.test(variable.id ?? "")) {
    error(`Invalid variable id: ${variable.id ?? "<missing>"}.`);
  } else if (declared.has(variable.id)) {
    error(`Duplicate variable id: ${variable.id}.`);
  } else {
    declared.set(variable.id, variable);
  }
  if (typeof variable.label !== "string" || !variable.label.trim()) {
    error(`Variable ${variable.id ?? "<unknown>"} needs a label.`);
  }
  if (!ALLOWED_TYPES.has(variable.type)) {
    error(`Variable ${variable.id ?? "<unknown>"} has unsupported type ${variable.type}.`);
  }
  if (!ALLOWED_GROUPS.has(variable.group)) {
    error(`Variable ${variable.id ?? "<unknown>"} has unsupported group ${variable.group}.`);
  }
}

let html = "";
if (await exists(entryPath)) {
  html = await readFile(entryPath, "utf8");
}

const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] ?? "";
const compositionVariablesSource = attribute(htmlTag, "data-composition-variables");
let compositionVariables = [];
if (!compositionVariablesSource) {
  error("The root html element needs data-composition-variables.");
} else {
  try {
    compositionVariables = JSON.parse(compositionVariablesSource);
    if (!Array.isArray(compositionVariables)) error("data-composition-variables must be a JSON array.");
  } catch {
    error("data-composition-variables must contain valid JSON.");
  }
}

const compositionIds = new Set(
  Array.isArray(compositionVariables)
    ? compositionVariables.map((variable) => variable?.id).filter((id) => typeof id === "string")
    : [],
);

if (compositionIds.size !== compositionVariables.length) {
  error("data-composition-variables contains a missing or duplicate id.");
}

for (const compositionVariable of compositionVariables) {
  if (!declared.has(compositionVariable.id)) {
    error(`Composition variable ${compositionVariable.id ?? "<missing>"} is not declared in the manifest.`);
    continue;
  }
  const manifestVariable = declared.get(compositionVariable.id);
  const expectedType = COMPOSITION_TYPE_BY_MANIFEST_TYPE.get(manifestVariable.type);
  if (compositionVariable.type !== expectedType) {
    error(
      `Composition variable ${compositionVariable.id} must use HyperFrames type ${expectedType}, not ${compositionVariable.type}.`,
    );
  }
  if (!Object.hasOwn(compositionVariable, "default")) {
    error(`Composition variable ${compositionVariable.id} needs a default value.`);
  }
}

for (const [id, variable] of declared) {
  if (!compositionIds.has(id)) error(`Manifest variable ${id} is missing from data-composition-variables.`);
  const escapedId = escapeRegExp(id);
  const textBinding = new RegExp(`data-var-text\\s*=\\s*["']${escapedId}["']`, "i").test(html);
  const imageBinding = new RegExp(`data-var-src\\s*=\\s*["']${escapedId}["']`, "i").test(html);
  const cssId = id.startsWith("--") ? id : `--${id}`;
  const cssBinding = new RegExp(`${escapeRegExp(cssId)}\\s*:`, "i").test(html);
  const genericBinding = new RegExp(`data-var-[a-z-]+\\s*=\\s*["']${escapedId}["']`, "i").test(html);
  const isBound =
    variable.type === "text"
      ? textBinding
      : variable.type === "image"
        ? imageBinding
        : cssBinding || genericBinding;
  if (!isBound) error(`Variable ${id} has no ${variable.type} binding in index.html.`);
}

for (const match of html.matchAll(/data-var-(?:text|src)\s*=\s*(["'])(.*?)\1/gi)) {
  if (!declared.has(match[2])) error(`HTML binding ${match[2]} is not declared in the manifest.`);
}

const rootTag =
  html.match(/<[^>]+\bid\s*=\s*(["'])root\1[^>]*>/i)?.[0] ??
  html.match(/<[^>]+\bdata-composition-id\s*=\s*(["']).*?\1[^>]*>/i)?.[0] ??
  "";
if (!rootTag) {
  error("Missing composition root.");
} else {
  for (const name of ROOT_ATTRIBUTES) {
    if (attribute(rootTag, name) == null) error(`Composition root is missing ${name}.`);
  }
}

const rootDuration = rootTag ? numericAttribute(rootTag, "data-duration", "Composition root") : null;
const timedTags = [...html.matchAll(/<[^/!][^>]*\bclass\s*=\s*(["'])[^"']*\bclip\b[^"']*\1[^>]*>/gi)].map(
  (match) => match[0],
);
let latestEnd = 0;
for (const [index, tag] of timedTags.entries()) {
  const label = `Clip ${attribute(tag, "id") ?? index + 1}`;
  for (const name of CLIP_ATTRIBUTES) {
    if (attribute(tag, name) == null) error(`${label} is missing ${name}.`);
  }
  const start = numericAttribute(tag, "data-start", label);
  const duration = numericAttribute(tag, "data-duration", label);
  if (start != null && start < 0) error(`${label} starts before zero.`);
  if (duration != null && duration <= 0) error(`${label} duration must be greater than zero.`);
  if (start != null && duration != null) latestEnd = Math.max(latestEnd, start + duration);
}

const scenes = timedTags
  .filter((tag) => /\bclass\s*=\s*(["'])[^"']*\bscene\b[^"']*\1/i.test(tag))
  .map((tag, index) => ({
    id: attribute(tag, "id"),
    start: numericAttribute(tag, "data-start", `Scene ${attribute(tag, "id") ?? index + 1}`),
    duration: numericAttribute(tag, "data-duration", `Scene ${attribute(tag, "id") ?? index + 1}`),
  }));

if (scenes.length === 0) {
  warning("No .scene.clip nodes found; treating this as a single-frame composition.");
} else {
  const sceneIds = new Set();
  for (const scene of scenes) {
    if (!scene.id) error("Every scene needs a stable id.");
    else if (sceneIds.has(scene.id)) error(`Duplicate scene id: ${scene.id}.`);
    else sceneIds.add(scene.id);
  }
  const ordered = scenes.filter((scene) => scene.start != null && scene.duration != null).sort((a, b) => a.start - b.start);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (current.start < previous.start + previous.duration - 0.0001) {
      error(`Scene ${current.id} overlaps ${previous.id}.`);
    }
  }
}

if (rootDuration != null && rootDuration + 0.0001 < latestEnd) {
  error(`Composition duration ${rootDuration} does not cover timed content ending at ${latestEnd}.`);
}

if (!/gsap\.timeline\s*\(\s*\{[^}]*paused\s*:\s*true/i.test(html)) {
  error("Register a paused GSAP timeline.");
}
if (!/window\.__timelines/i.test(html)) error("Register the composition timeline on window.__timelines.");

const referencedUrls = [
  ...[...html.matchAll(/\s(?:src|href)\s*=\s*(["'])(.*?)\1/gi)].map((match) => match[2]),
  ...[...html.matchAll(/\burl\(\s*(["']?)(.*?)\1\s*\)/gi)].map((match) => match[2]),
  ...[...html.matchAll(/\b(?:load|fetch)\(\s*(["'])(.*?)\1/gi)].map((match) => match[2]),
];
const hasRemoteRuntimeReference =
  referencedUrls.some((reference) => /^https?:\/\//i.test(reference)) ||
  /@import\s+["']?https?:\/\//i.test(html);
if (hasRemoteRuntimeReference) {
  error("Remote runtime assets are not allowed; vendor scripts, fonts, and media locally.");
}

const assetReferences = referencedUrls
  .filter((reference) =>
    reference &&
    !reference.startsWith("data:") &&
    !reference.startsWith("#") &&
    !reference.startsWith("blob:") &&
    !reference.startsWith("http://") &&
    !reference.startsWith("https://"),
  );

for (const reference of assetReferences) {
  const cleanReference = reference.split(/[?#]/, 1)[0];
  const resolved = path.resolve(templateDirectory, cleanReference);
  const relative = path.relative(templateDirectory, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    error(`Asset escapes the template directory: ${reference}`);
  } else if (!(await exists(resolved))) {
    error(`Missing local asset: ${reference}`);
  }
}

for (const message of warnings) console.warn(`WARN: ${message}`);
for (const message of errors) console.error(`ERROR: ${message}`);

if (errors.length) {
  console.error(`FAIL: ${errors.length} error(s), ${warnings.length} warning(s).`);
  process.exit(1);
}

console.log(`PASS: ${manifest.id} (${declared.size} variables, ${scenes.length} scenes, ${warnings.length} warnings).`);

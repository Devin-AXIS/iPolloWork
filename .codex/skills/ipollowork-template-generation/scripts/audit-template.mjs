#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const args = process.argv.slice(2);
const directoryArg = args.find((arg) => !arg.startsWith("--"));
const surfaceArg = args.find((arg) => arg.startsWith("--surface="))?.split("=")[1]
  ?? (args.includes("--surface") ? args[args.indexOf("--surface") + 1] : undefined);

if (!directoryArg) {
  console.error("Usage: node audit-template.mjs <template-directory> [--surface web|slides|video]");
  process.exit(2);
}

const directory = resolve(directoryArg);
const errors = [];
const warnings = [];
const read = (path) => readFileSync(path, "utf8");
const manifestPath = join(directory, "manifest.json");

if (!existsSync(manifestPath)) errors.push("manifest.json is missing");
let manifest = {};
if (existsSync(manifestPath)) {
  try { manifest = JSON.parse(read(manifestPath)); }
  catch (error) { errors.push(`manifest.json is invalid JSON: ${error.message}`); }
}

const entryName = manifest.entry ?? (existsSync(join(directory, "index.html")) ? "index.html" : "entry.html");
const entryPath = join(directory, entryName);
const tokenName = manifest.designSystem?.tokens ?? "design-tokens.css";
const tokenPath = join(directory, tokenName);

if (manifest.designSystem?.tokens !== "design-tokens.css") errors.push('manifest designSystem.tokens must be "design-tokens.css"');
if (!existsSync(entryPath)) errors.push(`entry file is missing: ${entryName}`);
if (!existsSync(tokenPath)) errors.push(`token file is missing: ${tokenName}`);

const html = existsSync(entryPath) ? read(entryPath) : "";
const css = existsSync(tokenPath) ? read(tokenPath) : "";
const links = [...html.matchAll(/<link\b[^>]*\bhref=["']([^"']*design-tokens?\.css)["'][^>]*>/gi)];
if (links.length !== 1) errors.push(`entry must contain exactly one design token link; found ${links.length}`);
if (links.length === 1 && !/data-ipw-design-tokens/i.test(links[0][0])) errors.push("design token link needs data-ipw-design-tokens");
if (links.length === 1 && links[0].index <= html.lastIndexOf("</style>")) errors.push("design token link must appear after every inline <style> block");

const requiredTokens = [
  "--ipw-color-bg", "--ipw-color-surface", "--ipw-color-text", "--ipw-color-muted",
  "--ipw-color-border", "--ipw-color-primary", "--ipw-font-display", "--ipw-font-body",
  "--ipw-button-radius", "--ipw-card-radius",
];
for (const token of requiredTokens) if (!css.includes(token)) errors.push(`missing required token: ${token}`);

if (/<html\b[^>]*\bstyle=["'][^"']*--ipw-/i.test(html)) errors.push("do not define --ipw-* tokens on the html style attribute");
const tokenLinkEnd = links.length === 1 ? links[0].index + links[0][0].length : -1;
if (tokenLinkEnd >= 0 && /--ipw-[\w-]+\s*:/.test(html.slice(tokenLinkEnd))) errors.push("an inline --ipw-* declaration appears after the token link");

const inferredSurface = surfaceArg
  ?? (manifest.surface === "video" || manifest.category === "video" ? "video" : manifest.category === "slides" ? "slides" : "web");
if (!new Set(["web", "slides", "video"]).has(inferredSurface)) errors.push(`unknown surface: ${inferredSurface}`);

if (inferredSurface === "slides") {
  if (!/\bdata-ipw-slide(?:\s|=|>)/i.test(html)
    && !/class=["'][^"']*\b(?:slide|slide-frame)\b/i.test(html)
    && !/className\s*=\s*["'](?:slide|slide-frame)["']/i.test(html)
    && !/classList\.add\(\s*["'](?:slide|slide-frame)["']/i.test(html)) errors.push("slides template has no recognized slide root");
  if (manifest.pptxCompatibility && !/\bdata-pptx-(?:text|shape|image)\b/i.test(html)) errors.push("PPTX-compatible template has no data-pptx-* markers");
}

if (inferredSurface === "video") {
  if (!/\bdata-composition-id=/i.test(html)) errors.push("video template has no data-composition-id");
  if (!/\bdata-duration=/i.test(html)) errors.push("video template has no data-duration");
  if (!/--accent\s*:\s*var\(--ipw-color-primary\)\s*!important/i.test(css)) warnings.push("video template does not bridge --accent to --ipw-color-primary");
}

if (/(?:^|})\s*(?:img|svg)\s*\{[^}]*\b(?:width|height)\s*:/is.test(css)) warnings.push("token CSS contains global img/svg sizing; verify theme switching cannot resize icons or logos");
if (/\b(?:data-duration|data-track-index|data-from|data-to)\b/.test(css)) errors.push("timing declarations do not belong in design-tokens.css");

const result = {
  template: manifest.id ?? basename(directory),
  surface: inferredSurface,
  entry: entryName,
  tokens: tokenName,
  errors,
  warnings,
};
console.log(JSON.stringify(result, null, 2));
process.exit(errors.length ? 1 : 0);

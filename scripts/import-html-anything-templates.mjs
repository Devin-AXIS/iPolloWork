#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const SOURCE_CATEGORY = {
  prototype: "site",
  slides: "slides",
  video: "video",
  article: "article",
  poster: "poster",
  card: "cards",
  data: "report",
  finance: "report",
};

// These are usable design templates, but their original upstream buckets do
// not describe the user's job well enough to occupy a primary Market category.
const CATEGORY_BY_NAME = {
  invoice: "other",
  "mockup-device-3d": "other",
  "sprite-animation": "other",
  "frame-liquid-bg-hero": "other",
};

// These upstream Skills are intentionally not offered in the iPolloWork
// template market. Keep this source-level denylist so re-importing the
// upstream catalog cannot restore them.
const EXCLUDED_TEMPLATE_SKILLS = new Set([
  "deck-xhs-post",
  "social-x-post-card",
]);

// Deliberately explicit: an upstream filename never gets to invent a market
// style. Each official template is reviewed into one stable iPolloWork family.
const STYLE_BY_NAME = {
  "article-magazine": "newsprint",
  "article-sketchnote-editorial": "editorial",
  "blog-post": "minimal",
  "card-twitter": "minimal",
  "card-xiaohongshu": "playful",
  "data-report": "data",
  "deck-blueprint": "technical",
  "deck-course-module": "playful",
  "deck-dir-key-nav": "minimal",
  "deck-graphify-dark": "dark",
  "deck-guizang-editorial": "editorial",
  "deck-hermes-cyber": "cyber",
  "deck-ljg-present": "bold",
  "deck-magazine-web": "editorial",
  "deck-obsidian-claude": "dark",
  "deck-open-slide-canvas": "minimal",
  "deck-pitch": "minimal",
  "deck-presenter-mode": "dark",
  "deck-product-launch": "bold",
  "deck-replit": "dark",
  "deck-safety-alert": "bold",
  "deck-simple": "minimal",
  "deck-swiss-international": "swiss",
  "deck-tech-sharing": "technical",
  "deck-xhs-pastel": "pastel",
  "deck-xhs-post": "playful",
  "deck-xhs-white": "editorial",
  "digital-eguide": "editorial",
  "experiment-readout": "data",
  "finance-report": "data",
  "frame-data-chart-nyt": "data",
  "frame-flowchart-sticky": "sketch",
  "frame-glitch-title": "cyber",
  "frame-light-leak-cinema": "cinematic",
  "frame-liquid-bg-hero": "glass",
  "frame-logo-outro": "minimal",
  "frame-macos-notification": "soft",
  "info-funnel": "data",
  invoice: "minimal",
  "magazine-poster": "newsprint",
  "mockup-device-3d": "soft",
  "motion-frames": "cinematic",
  "poster-hero": "bold",
  "ppt-keynote": "minimal",
  "pricing-page": "minimal",
  "prototype-web": "minimal",
  "saas-landing": "glass",
  "social-carousel": "bold",
  "social-reddit-card": "bold",
  "social-spotify-card": "dark",
  "social-x-post-card": "minimal",
  "sprite-animation": "retro",
  "vfx-text-cursor": "cyber",
  "video-hyperframes": "cinematic",
  "waitlist-page": "soft",
  "web-proto-brutalist": "brutalist",
  "web-proto-editorial": "editorial",
  "web-proto-soft": "soft",
  "weekly-update": "editorial",
  "wireframe-sketch": "sketch",
};

const PALETTES = {
  minimal: ["#111827", "#ffffff", "#f8fafc", "#475569"],
  editorial: ["#6f2c3f", "#fffdf8", "#f4efe7", "#5c554d"],
  newsprint: ["#a33a24", "#f4eddf", "#fbf7ee", "#5b5349"],
  swiss: ["#002fa7", "#fafaf8", "#ffffff", "#424242"],
  bold: ["#ef3f62", "#fff8f5", "#ffffff", "#5f4850"],
  soft: ["#7c6ee6", "#f7f5ff", "#ffffff", "#69647b"],
  pastel: ["#df6e9f", "#fff6fb", "#ffffff", "#796575"],
  glass: ["#635bff", "#f4f6ff", "#ffffff", "#596078"],
  dark: ["#8b7cff", "#0d1017", "#171b25", "#9ca5b6"],
  cyber: ["#19e6c4", "#07120f", "#0c1d19", "#8ea9a3"],
  technical: ["#2f72ff", "#f2f7ff", "#ffffff", "#4b607e"],
  playful: ["#ff6b35", "#fff8df", "#ffffff", "#6f6250"],
  cinematic: ["#f4b860", "#090b10", "#151821", "#a5aaba"],
  data: ["#1677ff", "#f3f7fb", "#ffffff", "#587084"],
  brutalist: ["#ffef00", "#f5f5f0", "#ffffff", "#3f3f3a"],
  retro: ["#ff5c35", "#ffedb8", "#fff8de", "#6c4e3b"],
  sketch: ["#275efe", "#f8f3e8", "#fffdf7", "#655f55"],
};

const ELECTRON_CANDIDATES = [
  process.env.ELECTRON_BIN,
  resolve("node_modules/.pnpm/electron@35.7.5/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
].filter(Boolean);

const COVER_VIEWPORTS = {
  site: [1440, 900],
  slides: [1920, 1080],
  video: [1920, 1080],
  article: [1440, 900],
  poster: [1080, 1350],
  cards: [1080, 1080],
  report: [1440, 900],
  other: [1440, 900],
};

const SAMPLE_COPY = {
  site: {
    labels: ["Home", "Product", "Solutions", "Customers", "About", "Contact", "Get started", "Learn more"],
    headings: ["Build what matters.", "A clearer way to move forward", "Made for ambitious teams", "Everything you need to grow"],
    paragraphs: [
      "Turn a strong idea into a polished digital experience with a system designed for clarity, speed, and focus.",
      "Bring your product, story, and brand together in one flexible space that is easy to edit and ready to share.",
      "Thoughtful details and reusable sections help every page feel consistent from the first screen to the final call to action.",
    ],
  },
  slides: {
    labels: ["Overview", "Opportunity", "Strategy", "Product", "Market", "Growth", "Team", "Next"],
    headings: ["Ideas worth sharing", "A focused path to growth", "Designed for the next chapter", "From insight to impact"],
    paragraphs: [
      "A concise presentation system for turning complex ideas into a clear and memorable story.",
      "Use strong hierarchy, purposeful visuals, and focused evidence to keep every slide moving the narrative forward.",
      "Each section is editable and structured to help teams present with confidence.",
    ],
  },
  video: {
    labels: ["Play", "Scene", "Story", "Motion", "Focus", "Brand", "Reveal", "Watch"],
    headings: ["Make every frame count", "A story in motion", "Designed to be remembered", "Bring the idea to life"],
    paragraphs: [
      "A cinematic composition built for clear messages, expressive motion, and direct visual editing.",
      "Shape the pacing, color, and typography while keeping the story coherent from opening frame to final mark.",
      "Replace the sample content with your own product, campaign, or announcement.",
    ],
  },
  article: {
    labels: ["Journal", "Ideas", "Culture", "Design", "Research", "Read", "Share", "Archive"],
    headings: ["A story with room to breathe", "Notes on making better work", "Where ideas become perspective", "Designed for thoughtful reading"],
    paragraphs: [
      "A considered editorial layout that gives long-form writing a calm rhythm and a distinctive point of view.",
      "Strong typography, generous spacing, and flexible media blocks make every section easy to read and easy to shape.",
      "Use this space for essays, interviews, field notes, or a publication with a voice of its own.",
    ],
  },
  poster: {
    labels: ["Edition", "Studio", "Now", "Live", "Featured", "Details", "Discover", "Join us"],
    headings: ["Make a bold statement", "An idea made visible", "Designed to stop the scroll", "One message. Strong impact."],
    paragraphs: [
      "A high-impact poster system with expressive type, confident composition, and editable campaign details.",
      "Change the message, palette, and imagery while preserving the visual rhythm of the original design.",
      "Ideal for launches, events, announcements, and cultural moments.",
    ],
  },
  cards: {
    labels: ["Featured", "New", "Today", "Saved", "Share", "View", "Explore", "Follow"],
    headings: ["A small format with a big idea", "Made to be shared", "One clear message", "Keep the story moving"],
    paragraphs: [
      "A compact social format designed for quick reading, strong hierarchy, and easy brand customization.",
      "Replace the message, imagery, and color system while keeping every detail balanced and legible.",
      "Use it for announcements, insights, highlights, or a connected campaign series.",
    ],
  },
  report: {
    labels: ["Summary", "Performance", "Revenue", "Growth", "Insights", "Outlook", "Method", "Details"],
    headings: ["The signal behind the numbers", "Performance at a glance", "What changed and why", "A clearer view of progress"],
    paragraphs: [
      "A structured reporting system that turns data, evidence, and commentary into a clear executive narrative.",
      "Use the editable metrics, charts, and sections to explain performance without losing the important context.",
      "Designed for reviews, research, financial updates, and decision-ready analysis.",
    ],
  },
  other: {
    labels: ["Document", "Details", "Preview", "Share", "Edit", "Save", "Export", "Use template"],
    headings: ["A flexible starting point", "Make the format your own", "Ready for the details", "Built for the in-between"],
    paragraphs: [
      "A versatile editable layout for documents, profiles, mockups, and formats that do not need a dedicated category.",
      "Replace the sample content, visual tokens, and assets while keeping the original composition clear and easy to use.",
      "Use it as a focused starting point, then adapt it to the job in front of you.",
    ],
  },
};

const DESIGN_VARIABLES = [
  ["--ipw-color-primary", "Primary", "color", "theme"],
  ["--ipw-color-secondary", "Secondary", "color", "theme"],
  ["--ipw-color-accent", "Accent", "color", "theme"],
  ["--ipw-color-bg", "Page background", "color", "background"],
  ["--ipw-color-surface", "Surface", "color", "background"],
  ["--ipw-color-text", "Text", "color", "theme"],
  ["--ipw-color-muted", "Muted text", "color", "theme"],
  ["--ipw-color-border", "Border", "color", "components"],
  ["--ipw-font-display", "Display font", "font", "typography"],
  ["--ipw-font-body", "Body font", "font", "typography"],
  ["--ipw-type-scale", "Type scale", "number", "typography"],
  ["--ipw-body-line-height", "Line height", "number", "typography"],
  ["--ipw-content-width", "Content width", "number", "components"],
  ["--ipw-page-padding", "Page padding", "number", "components"],
  ["--ipw-section-space", "Section spacing", "number", "components"],
  ["--ipw-button-radius", "Button radius", "number", "components"],
  ["--ipw-card-bg", "Card background", "color", "components"],
  ["--ipw-card-border", "Card border", "color", "components"],
  ["--ipw-card-radius", "Card radius", "number", "components"],
  ["--ipw-card-shadow", "Card shadow", "text", "components"],
].map(([id, label, type, group]) => ({ id, label, type, group }));

const VIDEO_VARIABLES = [
  { id: "title", label: "Title", type: "text", group: "content" },
  { id: "brandName", label: "Brand name", type: "text", group: "brand" },
  { id: "logoUrl", label: "Brand logo", type: "image", group: "brand" },
  { id: "accent", label: "Accent", type: "color", group: "theme" },
];

function parseFrontmatter(source) {
  const block = source.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const read = (key) => block.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim();
  const clean = (value = "") => value.replace(/^"|"$/g, "");
  let tags = [];
  try { tags = JSON.parse(read("tags") ?? "[]"); } catch { tags = []; }
  return {
    name: clean(read("name")),
    title: clean(read("en_name")) || clean(read("name")),
    category: clean(read("category")),
    scenario: clean(read("scenario")),
    aspect: clean(read("aspect_hint")),
    tags,
  };
}

function escapeXml(value) {
  return value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]);
}

function tokenCss(style) {
  const [primary, background, surface, muted] = PALETTES[style];
  const dark = ["dark", "cyber", "cinematic"].includes(style);
  const text = dark ? "#f7f8fb" : "#12151b";
  const border = dark ? "#303746" : "#dfe3ea";
  const display = ["editorial", "newsprint"].includes(style) ? "Georgia, 'Times New Roman', serif" : "Inter, ui-sans-serif, system-ui, sans-serif";
  return `:root {
  --ipw-color-primary: ${primary};
  --ipw-color-secondary: ${muted};
  --ipw-color-accent: ${primary};
  --ipw-color-bg: ${background};
  --ipw-color-surface: ${surface};
  --ipw-color-text: ${text};
  --ipw-color-muted: ${muted};
  --ipw-color-border: ${border};
  --ipw-font-display: ${display};
  --ipw-font-body: Inter, ui-sans-serif, system-ui, sans-serif;
  --ipw-type-scale: 1;
  --ipw-body-line-height: 1.55;
  --ipw-content-width: 1200px;
  --ipw-page-padding: clamp(20px, 4vw, 56px);
  --ipw-section-space: clamp(48px, 8vw, 112px);
  --ipw-button-radius: 12px;
  --ipw-card-bg: ${surface};
  --ipw-card-border: ${border};
  --ipw-card-radius: 20px;
  --ipw-card-shadow: 0 18px 54px rgba(15, 23, 42, .1);
}
html { color-scheme: ${dark ? "dark" : "light"}; }
body { background-color: var(--ipw-color-bg) !important; color: var(--ipw-color-text); font-family: var(--ipw-font-body); line-height: var(--ipw-body-line-height); }
h1, h2, h3, h4 { font-family: var(--ipw-font-display); }
a, button, [role="button"] { border-radius: var(--ipw-button-radius); }
::selection { background: color-mix(in srgb, var(--ipw-color-accent) 32%, transparent); }
:is([class*="eyebrow"], [class*="kicker"], [class*="accent"]) { color: var(--ipw-color-accent) !important; }
:is(button, [role="button"], a[class*="button"], a[class*="btn"], a[class*="cta"]) { border-color: var(--ipw-color-primary); }
:is(article, [class*="card"]) { border-color: var(--ipw-card-border); border-radius: var(--ipw-card-radius); }
.ipw-brand-slot { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; display: inline-flex; align-items: center; gap: 7px; padding: 7px 10px; border: 1px solid color-mix(in srgb, var(--ipw-color-primary) 35%, var(--ipw-color-border)); border-radius: 999px; background: color-mix(in srgb, var(--ipw-color-surface) 84%, transparent); color: var(--ipw-color-text); box-shadow: 0 12px 44px color-mix(in srgb, var(--ipw-color-primary) 18%, transparent); font: 600 11px/1 var(--ipw-font-body); letter-spacing: -.01em; backdrop-filter: blur(14px); }
.ipw-brand-slot img { width: 18px; height: 18px; object-fit: contain; }
@media (max-width: 640px) { .ipw-brand-slot { right: 10px; bottom: 10px; } }
`;
}

function englishDescription(title, category, style) {
  const kind = { site: "website", slides: "presentation", video: "video", article: "editorial", poster: "poster", cards: "social card", report: "data report" }[category];
  return `${title} is an editable ${kind} template with a ${style} visual system, reusable brand controls, and polished sample content.`;
}

const EAST_ASIAN_TEXT = /[\u3000-\u30ff\u31f0-\u31ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]+/g;

function isEastAsianCodePoint(code) {
  return (code >= 0x3000 && code <= 0x30ff)
    || (code >= 0x31f0 && code <= 0x31ff)
    || (code >= 0x3400 && code <= 0x9fff)
    || (code >= 0xac00 && code <= 0xd7af)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xff00 && code <= 0xffef);
}

function escapeEastAsianRegexLiterals(block) {
  return block.replace(/\/(?:\\.|[^/\n])+\/[dgimsuvy]*/g, (literal) => {
    if (!/[\u3000-\u30ff\u31f0-\u31ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/.test(literal)) return literal;
    return [...literal].map((character) => {
      const code = character.codePointAt(0);
      return isEastAsianCodePoint(code)
        ? `\\u${code.toString(16).padStart(4, "0")}`
        : character;
    }).join("");
  });
}

function englishizeHtml(source, meta, category) {
  const copy = SAMPLE_COPY[category];
  const counters = { label: 0, heading: 0, paragraph: 0 };
  const protectedBlocks = [];
  let html = source.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, (block, kind) => {
    const safeBlock = kind.toLowerCase() === "script" ? escapeEastAsianRegexLiterals(block) : block;
    protectedBlocks.push(safeBlock.replace(EAST_ASIAN_TEXT, "Studio"));
    return `__IPW_PROTECTED_${protectedBlocks.length - 1}__`;
  });
  html = html.replace(/>([^<]*[\u3000-\u30ff\u31f0-\u31ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef][^<]*)</g, (_match, rawText) => {
    const leading = rawText.match(/^\s*/)?.[0] ?? "";
    const trailing = rawText.match(/\s*$/)?.[0] ?? "";
    const text = rawText.trim();
    const cjkLength = (text.match(/[\u3000-\u30ff\u31f0-\u31ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g) ?? []).length;
    let replacement;
    if (cjkLength <= 6 && text.length <= 24) {
      replacement = copy.labels[counters.label++ % copy.labels.length];
    } else if (cjkLength <= 24 && text.length <= 80) {
      replacement = counters.heading++ === 0 ? meta.title : copy.headings[(counters.heading - 1) % copy.headings.length];
    } else {
      replacement = copy.paragraphs[counters.paragraph++ % copy.paragraphs.length];
    }
    return `>${leading}${replacement}${trailing}<`;
  });
  html = html.replace(/__IPW_PROTECTED_(\d+)__/g, (_match, index) => protectedBlocks[Number(index)]);
  return html
    .replace(EAST_ASIAN_TEXT, "Studio")
    .replace(/lang=(['"])zh(?:-CN)?\1/gi, 'lang="en"');
}

async function findElectron() {
  for (const candidate of ELECTRON_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error("The workspace Electron runtime is required to render real template covers. Run pnpm install or set ELECTRON_BIN.");
}

function coverPreview(entry, category, style) {
  const [frameWidth, frameHeight] = COVER_VIEWPORTS[category];
  const scale = Math.min(960 / frameWidth, 540 / frameHeight);
  const fittedWidth = frameWidth * scale;
  const fittedHeight = frameHeight * scale;
  const [, background] = PALETTES[style];
  return `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{width:960px;height:540px;margin:0;overflow:hidden;background:${background}}body{display:grid;place-items:center}.viewport{position:relative;width:${fittedWidth}px;height:${fittedHeight}px;overflow:hidden;box-shadow:0 20px 70px rgba(15,23,42,.18)}iframe{position:absolute;inset:0;width:${frameWidth}px;height:${frameHeight}px;border:0;transform:scale(${scale});transform-origin:top left;background:white}</style></head><body><div class="viewport"><iframe src="./${entry}" title="Template first screen"></iframe></div></body></html>`;
}

async function renderCovers(templates) {
  const electron = await findElectron();
  const runnerDirectory = await mkdtemp(join(tmpdir(), "ipw-cover-runner-"));
  const runner = join(runnerDirectory, "main.cjs");
  const previews = templates.map((template) => join(template.destination, ".cover-preview.html"));
  await Promise.all(templates.map((template, index) => writeFile(previews[index], coverPreview(template.entry, template.category, template.style))));
  const serializedJobs = JSON.stringify(templates.map((template, index) => ({
    id: template.id,
    preview: previews[index],
    cover: join(template.destination, "cover.png"),
  })));
  await writeFile(runner, `const { app, BrowserWindow } = require("electron");
const { writeFile } = require("node:fs/promises");
const jobs = JSON.parse(process.env.IPW_COVER_JOBS);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.commandLine.appendSwitch("force-device-scale-factor", "1");

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 960,
    height: 540,
    useContentSize: true,
    webPreferences: { offscreen: true, backgroundThrottling: false, webSecurity: false },
  });
  window.setContentSize(960, 540);
  for (const job of jobs) {
    await window.loadFile(job.preview);
    await Promise.race([
      window.webContents.executeJavaScript(\`(async () => {
        const frame = document.querySelector("iframe");
        if (frame && frame.contentDocument?.readyState !== "complete") {
          await new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
        }
        const frameDocument = frame?.contentDocument;
        await frameDocument?.fonts?.ready;
        await Promise.all(Array.from(frameDocument?.images ?? []).map((image) => image.complete
          ? Promise.resolve()
          : new Promise((resolve) => image.addEventListener("load", resolve, { once: true }))));
      })()\`),
      delay(1_500),
    ]);
    // Capture after the opening layout/animation has settled enough to make a
    // useful market cover; several motion templates intentionally start blank.
    await delay(1_100);
    const image = await window.webContents.capturePage({ x: 0, y: 0, width: 960, height: 540 });
    const normalized = image.getSize().width === 960 && image.getSize().height === 540
      ? image
      : image.resize({ width: 960, height: 540, quality: "best" });
    await writeFile(job.cover, normalized.toPNG());
  }
  window.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
`);
  try {
    await new Promise((accept, reject) => {
      let stderr = "";
      const child = spawn(electron, [runner], {
        env: { ...process.env, IPW_COVER_JOBS: serializedJobs },
        stdio: ["ignore", "ignore", "pipe"],
      });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? accept() : reject(new Error(`Electron cover render exited with ${code}: ${stderr.trim()}`)));
    });
  } finally {
    await Promise.all([...previews.map((preview) => rm(preview, { force: true })), rm(runnerDirectory, { recursive: true, force: true })]);
  }
}

function adaptBranding(html) {
  return html
    .replaceAll("https://github.com/nexu-io/open-design/issues", "https://github.com/Devin-AXIS/iPolloWork/issues")
    .replaceAll("https://github.com/nexu-io/open-design", "https://github.com/Devin-AXIS/iPolloWork")
    .replace(/html(?:-|\s)anything(?:\.dev)?/gi, "iPolloWork")
    .replace(/open(?:-|\s)design/gi, "iPolloWork")
    .replace(/filebase/gi, "iPolloWork")
    .replace(/flowai/gi, "iPolloWork");
}

function adaptDesignHtml(source, meta) {
  let html = adaptBranding(source);
  const link = '<link rel="stylesheet" href="design-tokens.css">';
  html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${link}</head>`) : `${link}${html}`;
  const slot = '<div class="ipw-brand-slot" data-ipw-brand-slot><img src="assets/ipollowork-logo.svg" alt="iPolloWork logo" data-ipw-logo><span data-ipw-text="brand.name">iPolloWork</span></div>';
  html = /<body\b[^>]*>/i.test(html) ? html.replace(/<body\b([^>]*)>/i, `<body$1>${slot}`) : `${slot}${html}`;
  return html.replace(/<html\b([^>]*)>/i, `<html$1 data-ipw-template="${meta.name}" data-ipw-style="${STYLE_BY_NAME[meta.name]}">`);
}

function adaptVideoHtml(source, meta, accent) {
  let html = adaptBranding(source);
  const declarations = JSON.stringify([
    { id: "title", type: "string", label: "Title", default: meta.title },
    { id: "brandName", type: "string", label: "Brand name", default: "iPolloWork" },
    { id: "logoUrl", type: "string", label: "Brand logo", default: "assets/ipollowork-logo.svg" },
    { id: "accent", type: "color", label: "Accent", default: accent },
  ]).replaceAll("'", "\\u0027");
  html = html.replace(/<html\b([^>]*)>/i, `<html$1 data-composition-variables='${declarations}' data-ipw-template="${meta.name}">`);
  const overlay = `<div class="ipw-video-brand"><img src="assets/ipollowork-logo.svg" data-var-src="logoUrl" alt="Brand logo"><span data-var-text="brandName">iPolloWork</span><b data-var-text="title">${escapeXml(meta.title)}</b></div>`;
  const css = `<style>:root{--accent:${accent}}.ipw-composition-root{position:relative;width:100%;min-height:100vh;overflow:hidden}.ipw-video-brand{position:absolute;right:42px;bottom:32px;z-index:999999;display:flex;align-items:center;gap:10px;color:#fff;font:600 16px/1.2 Inter,system-ui,sans-serif;text-shadow:0 1px 16px #000}.ipw-video-brand img{width:28px;height:28px;object-fit:contain}.ipw-video-brand b{margin-left:10px;color:var(--accent);font-size:12px;letter-spacing:.08em;text-transform:uppercase}</style>`;
  html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${css}</head>`) : `${css}${html}`;
  html = html.replace(/<body\b([^>]*)>/i, `<body$1><div id="root" class="ipw-composition-root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="8">${overlay}`);
  return html.replace(/<\/body>/i, "</div></body>");
}

async function main() {
  const upstream = resolve(process.argv[2] ?? "");
  if (!upstream) throw new Error("Usage: node scripts/import-html-anything-templates.mjs /path/to/html-anything");
  const skillsRoot = join(upstream, "next", "src", "lib", "templates", "skills");
  const outputRoot = resolve("apps/server/bundled-templates");
  const stagingRoot = await mkdtemp(join(outputRoot, ".html-anything-stage-"));
  const revision = (await readFile(join(upstream, ".git", "refs", "heads", "main"), "utf8").catch(() => "d0efb1eaa3b65c731709981718cd5a0a0d4e8f71")).trim();
  const license = await readFile(join(upstream, "LICENSE"), "utf8");
  const logo = await readFile(resolve("apps/app/public/ipollowork-logo.svg"), "utf8");

  const imported = [];
  for (const name of (await readdir(skillsRoot)).sort()) {
    if (EXCLUDED_TEMPLATE_SKILLS.has(name)) continue;
    const directory = join(skillsRoot, name);
    const meta = parseFrontmatter(await readFile(join(directory, "SKILL.md"), "utf8"));
    const category = CATEGORY_BY_NAME[name] ?? SOURCE_CATEGORY[meta.category];
    if (!category) continue;
    const style = STYLE_BY_NAME[name];
    if (!style) throw new Error(`Missing reviewed style for ${name}`);
    const isVideo = category === "video";
    const id = `ipollowork.html-anything.${name}`;
    const destination = join(stagingRoot, id);
    const [accent] = PALETTES[style];
    const manifest = {
      schemaVersion: 1,
      id,
      version: "1.1.4",
      kind: "design",
      category,
      subcategory: meta.scenario || basename(name),
      style,
      tags: [...new Set([meta.scenario, ...meta.tags].filter((tag) => tag && /^[\x20-\x7e]+$/.test(String(tag))).map((tag) => String(tag).slice(0, 32)))].slice(0, 12),
      surface: isVideo ? "video" : "design",
      title: meta.title,
      description: englishDescription(meta.title, category, style),
      cover: "cover.png",
      entry: isVideo ? "index.html" : "entry.html",
      source: {
        name: "iPolloWork · HTML Anything",
        repository: "https://github.com/nexu-io/html-anything",
        license: "Apache-2.0",
        revision,
        attribution: `Adapted from HTML Anything / ${name}; visual system and editable variables added by iPolloWork.`,
      },
      designSystem: {
        tokenVersion: 1,
        editableGroups: ["theme", "background", "typography", "components"],
        ...(isVideo ? {} : { tokens: "design-tokens.css" }),
        variables: isVideo ? VIDEO_VARIABLES : DESIGN_VARIABLES,
      },
      applyChecklist: [
        "Replace all sample copy with the user's complete brief.",
        "Replace the iPolloWork demo logo through the editable brand slot when needed.",
        "Apply the selected palette through declared variables without breaking the template hierarchy.",
        `Keep the ${style} visual language and ${category} composition coherent.`,
        "Verify responsive layout, links, overflow and editable text before finishing.",
      ],
      minimumAppVersion: "0.17.20",
    };

    const sourceHtml = await readFile(join(directory, "example.html"), "utf8");
    const adaptedHtml = isVideo ? adaptVideoHtml(sourceHtml, meta, accent) : adaptDesignHtml(sourceHtml, meta);
    const html = englishizeHtml(adaptedHtml, meta, category);
    await mkdir(join(destination, "assets"), { recursive: true });
    await writeFile(join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(destination, manifest.entry), html);
    await writeFile(join(destination, "assets", "ipollowork-logo.svg"), logo);
    await writeFile(join(destination, "LICENSE"), license);
    await writeFile(join(destination, "NOTICE"), `iPolloWork official template adaptation\n\nUpstream: HTML Anything / ${name}\nRepository: https://github.com/nexu-io/html-anything\nRevision: ${revision}\nLicense: Apache-2.0\n\nThe example was adapted for iPolloWork classification, branding, design tokens, direct editing, and template-market packaging.\n`);
    if (!isVideo) await writeFile(join(destination, "design-tokens.css"), tokenCss(style));
    imported.push({ id, category, style, destination, entry: manifest.entry });
  }

  if (imported.length !== 58) throw new Error(`Expected 58 selected templates, generated ${imported.length}`);
  try {
    await renderCovers(imported);
    for (const template of imported) {
      const destination = join(outputRoot, template.id);
      const backup = join(outputRoot, `.html-anything-backup-${template.id}`);
      await rm(backup, { recursive: true, force: true });
      let hadPrevious = false;
      try {
        await rename(destination, backup);
        hadPrevious = true;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      try {
        await rename(template.destination, destination);
      } catch (error) {
        if (hadPrevious) await rename(backup, destination);
        throw error;
      }
      await rm(backup, { recursive: true, force: true });
    }
    const selected = new Set(imported.map((template) => template.id));
    for (const name of await readdir(outputRoot)) {
      if (name.startsWith("ipollowork.html-anything.") && !selected.has(name)) await rm(join(outputRoot, name), { recursive: true, force: true });
    }
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
  const counts = imported.reduce((result, item) => ({ ...result, [item.category]: (result[item.category] ?? 0) + 1 }), {});
  console.log(`Imported ${imported.length} English HTML Anything templates with real first-screen covers: ${JSON.stringify(counts)}`);
}

await main();

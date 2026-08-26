import { createRequire } from "node:module";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const requireFromApp = createRequire(resolve(repositoryRoot, "apps/app/package.json"));
const sessionIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const sectionPageSize = 5;
const targetConfigs = {
  video: { category: "video", surface: "video", folder: "video", entry: "index.html", style: "cinematic" },
  slides: { category: "slides", surface: "design", folder: "design", entry: "entry.html", style: "minimal", pptxCompatibility: "native-editable" },
  poster: { category: "poster", surface: "design", folder: "design", entry: "entry.html", style: "editorial" },
  site: { category: "site", surface: "design", folder: "design", entry: "entry.html", style: "minimal" },
  article: { category: "article", surface: "design", folder: "design", entry: "entry.html", style: "editorial" },
  report: { category: "report", surface: "design", folder: "design", entry: "entry.html", style: "data" },
  cards: { category: "cards", surface: "design", folder: "design", entry: "entry.html", style: "bold" },
};

function usage() {
  return [
    "Usage:",
    "  node scripts/document-to-video-compiler.mjs --source <file.pdf|file.pptx> --session <sessionId> [--target video|slides|poster|site|article|report|cards] [--workspace <path>] [--goal <text>] [--title <text>] [--duration <seconds>] [--aspect <ratio>] [--force]",
    "  node scripts/document-to-video-compiler.mjs --blank --session <sessionId> [--target video|slides|poster|site|article|report|cards] [--workspace <path>] [--goal <text>] [--title <text>] [--duration <seconds>] [--aspect <ratio>] [--force]",
  ].join("\n");
}

function parseArguments(argv) {
  const args = {
    workspace: repositoryRoot,
    goal: "Create a concise editable video from the provided material.",
    title: "",
    duration: 60,
    aspect: "16:9",
    force: false,
    blank: false,
    source: "",
    session: "",
    target: "video",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--force") {
      args.force = true;
      continue;
    }
    if (key === "--blank") {
      args.blank = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value) throw new Error(usage());
    index += 1;
    if (key === "--source") args.source = value;
    else if (key === "--session") args.session = value;
    else if (key === "--workspace") args.workspace = resolve(value);
    else if (key === "--goal") args.goal = value;
    else if (key === "--title") args.title = value;
    else if (key === "--duration") args.duration = Math.max(5, Number(value) || 60);
    else if (key === "--aspect") args.aspect = value;
    else if (key === "--target") args.target = value;
    else throw new Error(usage());
  }
  if (!args.session || !sessionIdPattern.test(args.session)) throw new Error("Missing or invalid --session.");
  if (!targetConfigs[args.target]) throw new Error(`Unsupported --target: ${args.target}.`);
  if (args.blank && args.source) throw new Error("Use either --blank or --source, not both.");
  if (!args.blank && !args.source) throw new Error("Missing --source or --blank.");
  return args;
}

function now() {
  return new Date().toISOString();
}

function toPosix(value) {
  return value.split(sep).join("/");
}

function relativePath(from, to) {
  return toPosix(relative(from, to));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function titleFromText(text, fallback) {
  const line = String(text ?? "")
    .split(/\r?\n/)
    .map((entry) => compactText(entry))
    .find((entry) => entry.length >= 4);
  return (line || fallback).slice(0, 96);
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sourceDescriptor(sourceFile, pages = [], slides = []) {
  return {
    file: sourceFile,
    pages,
    slides,
    path: sourceFile,
  };
}

async function loadPdfJs() {
  const pdfModulePath = requireFromApp.resolve("pdfjs-dist/legacy/build/pdf.mjs");
  return import(pathToFileURL(pdfModulePath).href);
}

async function loadJsZip() {
  const jszipPath = requireFromApp.resolve("jszip");
  const module = await import(pathToFileURL(jszipPath).href);
  return module.default ?? module;
}

async function extractPdf(input) {
  const { sessionRoot, sourcePath, sourceFile, createdAt } = input;
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await readFile(sourcePath));
  const loadingTask = pdfjs.getDocument({
    data,
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;
  const pages = [];
  const coverage = [];
  const warnings = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    try {
      const page = await doc.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item) => typeof item.str === "string" ? item.str : "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      const pageId = `page-${String(pageNumber).padStart(3, "0")}`;
      const pageJson = {
        title: `Page ${pageNumber}`,
        schema_version: 1,
        created_at: createdAt,
        id: pageId,
        source: sourceDescriptor(sourceFile, [pageNumber], []),
        summary: text ? titleFromText(text, `Extracted text from page ${pageNumber}`) : `No text extracted from page ${pageNumber}.`,
        text,
        assets: [],
        warnings: text ? [] : ["No text extracted. The page may be scanned or image-heavy."],
      };
      const path = resolve(sessionRoot, "extracted/pages", `${pageId}.json`);
      await writeJson(path, pageJson);
      pages.push({ number: pageNumber, id: pageId, path: relativePath(sessionRoot, path), text });
      coverage.push({
        kind: "page",
        number: pageNumber,
        text_extracted: Boolean(text),
        images_extracted: false,
        tables_extracted: false,
        render_created: false,
        section_id: "",
        used_in_story: false,
        warnings: pageJson.warnings,
      });
    } catch (error) {
      warnings.push(`Page ${pageNumber}: ${error instanceof Error ? error.message : String(error)}`);
      coverage.push({
        kind: "page",
        number: pageNumber,
        text_extracted: false,
        images_extracted: false,
        tables_extracted: false,
        render_created: false,
        section_id: "",
        used_in_story: false,
        warnings: ["Page extraction failed."],
      });
    }
  }

  await doc.destroy();
  return {
    kind: "pdf",
    pageCount: doc.numPages,
    slideCount: 0,
    pages,
    assets: [],
    coverage,
    warnings,
  };
}

function sortedSlidePaths(files) {
  return files
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((left, right) => {
      const leftNumber = Number(left.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
      const rightNumber = Number(right.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
      return leftNumber - rightNumber;
    });
}

function extractSlideText(xml) {
  return [...String(xml).matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)]
    .map((match) => decodeXml(match[1]))
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseRelationships(xml) {
  const rels = new Map();
  for (const match of String(xml).matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = match[1];
    const id = attrs.match(/\bId="([^"]+)"/)?.[1];
    const target = attrs.match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) rels.set(id, target.replace(/^\.\.\//, "ppt/"));
  }
  return rels;
}

function slideEmbedIds(xml) {
  return [...String(xml).matchAll(/\br:embed="([^"]+)"/g)].map((match) => match[1]);
}

async function extractPptx(input) {
  const { sessionRoot, sourcePath, sourceFile, createdAt } = input;
  const JSZip = await loadJsZip();
  const zip = await JSZip.loadAsync(await readFile(sourcePath));
  const files = Object.keys(zip.files);
  const slidePaths = sortedSlidePaths(files);
  const pages = [];
  const assets = [];
  const coverage = [];
  const copiedAssets = new Map();

  for (let index = 0; index < slidePaths.length; index += 1) {
    const slideNumber = index + 1;
    const slidePath = slidePaths[index];
    const xml = await zip.file(slidePath).async("string");
    const text = extractSlideText(xml);
    const relsPath = slidePath.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
    const rels = zip.file(relsPath) ? parseRelationships(await zip.file(relsPath).async("string")) : new Map();
    const slideAssets = [];

    for (const embedId of slideEmbedIds(xml)) {
      const target = rels.get(embedId);
      if (!target || !zip.file(target)) continue;
      if (!copiedAssets.has(target)) {
        const assetId = `asset-${String(copiedAssets.size + 1).padStart(3, "0")}`;
        const extension = extname(target).toLowerCase() || ".bin";
        const outputPath = resolve(sessionRoot, "extracted/assets/images", `${assetId}${extension}`);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, await zip.file(target).async("nodebuffer"));
        copiedAssets.set(target, { assetId, outputPath });
        assets.push({
          id: assetId,
          title: basename(target),
          kind: "image",
          path: relativePath(sessionRoot, outputPath),
          source: sourceDescriptor(sourceFile, [], [slideNumber]),
          summary: `Embedded media from slide ${slideNumber}.`,
          recommended_use: "scene-visual",
          quality: { confidence: 0.85 },
        });
      }
      slideAssets.push(copiedAssets.get(target).assetId);
    }

    const pageId = `slide-${String(slideNumber).padStart(3, "0")}`;
    const pageJson = {
      title: `Slide ${slideNumber}`,
      schema_version: 1,
      created_at: createdAt,
      id: pageId,
      source: sourceDescriptor(sourceFile, [], [slideNumber]),
      summary: text ? titleFromText(text, `Extracted text from slide ${slideNumber}`) : `No text extracted from slide ${slideNumber}.`,
      text,
      assets: slideAssets,
      warnings: text ? [] : ["No text extracted from slide XML."],
    };
    const path = resolve(sessionRoot, "extracted/pages", `${pageId}.json`);
    await writeJson(path, pageJson);
    pages.push({ number: slideNumber, id: pageId, path: relativePath(sessionRoot, path), text, assetIds: slideAssets });
    coverage.push({
      kind: "slide",
      number: slideNumber,
      text_extracted: Boolean(text),
      images_extracted: slideAssets.length > 0,
      tables_extracted: false,
      render_created: false,
      section_id: "",
      used_in_story: false,
      warnings: pageJson.warnings,
    });
  }

  return {
    kind: "pptx",
    pageCount: 0,
    slideCount: slidePaths.length,
    pages,
    assets,
    coverage,
    warnings: slidePaths.length ? [] : ["No slides found in PPTX package."],
  };
}

async function extractBlank(goal) {
  return {
    kind: "blank",
    pageCount: 0,
    slideCount: 0,
    pages: [],
    assets: [],
    coverage: [],
    warnings: goal ? [] : ["Blank video created without a detailed goal."],
  };
}

async function buildSections(input) {
  const { sessionRoot, sourceFile, extraction, createdAt } = input;
  const sections = [];
  const pages = extraction.pages;
  if (!pages.length) {
    const id = "sec-001";
    const path = resolve(sessionRoot, "extracted/sections", `${id}.json`);
    const section = {
      title: input.title || "Blank video concept",
      schema_version: 1,
      created_at: createdAt,
      id,
      source: sourceDescriptor(sourceFile, [], []),
      summary: input.goal,
      content: [{ type: "paragraph", text: input.goal, source_pages: [] }],
      key_points: [{ id: "kp-001", text: input.goal, evidence: "User-provided blank video goal.", source_pages: [] }],
      noise_removed: [],
      warnings: [],
    };
    await writeJson(path, section);
    sections.push({
      id,
      title: section.title,
      path: relativePath(sessionRoot, path),
      pages: [],
      slides: [],
      summary: section.summary,
      asset_ids: [],
      keywords: [],
    });
    return sections;
  }

  const chunkSize = extraction.kind === "pptx" ? 1 : sectionPageSize;
  for (let start = 0; start < pages.length; start += chunkSize) {
    const chunk = pages.slice(start, start + chunkSize);
    const index = Math.floor(start / chunkSize) + 1;
    const id = `sec-${String(index).padStart(3, "0")}`;
    const path = resolve(sessionRoot, "extracted/sections", `${id}.json`);
    const text = chunk.map((page) => page.text).filter(Boolean).join("\n\n");
    const pageNumbers = extraction.kind === "pdf" ? chunk.map((page) => page.number) : [];
    const slideNumbers = extraction.kind === "pptx" ? chunk.map((page) => page.number) : [];
    const assetIds = [...new Set(chunk.flatMap((page) => page.assetIds ?? []))];
    const title = titleFromText(text, extraction.kind === "pptx" ? `Slide ${slideNumbers.join(", ")}` : `Pages ${pageNumbers.join("-")}`);
    const section = {
      title,
      schema_version: 1,
      created_at: createdAt,
      id,
      source: sourceDescriptor(sourceFile, pageNumbers, slideNumbers),
      summary: text ? titleFromText(text, title) : "No text extracted for this section.",
      content: [
        {
          type: "paragraph",
          text,
          source_pages: pageNumbers,
          source_slides: slideNumbers,
        },
        ...assetIds.map((assetId) => ({
          type: "image_ref",
          asset_id: assetId,
          caption: "Extracted visual asset",
          source_pages: pageNumbers,
          source_slides: slideNumbers,
        })),
      ],
      key_points: text ? [
        {
          id: "kp-001",
          text: titleFromText(text, title),
          evidence: "Automatically derived from extracted text.",
          source_pages: pageNumbers,
          source_slides: slideNumbers,
        },
      ] : [],
      noise_removed: [],
      warnings: text ? [] : ["Section has no extracted text."],
    };
    await writeJson(path, section);
    sections.push({
      id,
      title,
      path: relativePath(sessionRoot, path),
      pages: pageNumbers,
      slides: slideNumbers,
      summary: section.summary,
      asset_ids: assetIds,
      keywords: [],
    });
  }
  return sections;
}

function selectStorySections(sections, duration) {
  const sceneCount = Math.max(1, Math.min(10, Math.round(duration / 8)));
  return sections.slice(0, sceneCount);
}

async function writeStory(input) {
  const { sessionRoot, sections, args, createdAt } = input;
  const selected = selectStorySections(sections, args.duration);
  const selectedAssets = [...new Set(selected.flatMap((section) => section.asset_ids ?? []))];
  const videoBrief = {
    title: "Design Brief",
    schema_version: 1,
    created_at: createdAt,
    id: "design-brief-001",
    target: args.target,
    goal: args.goal,
    audience: "unspecified",
    duration_seconds: args.duration,
    aspect_ratio: args.aspect,
    tone: "professional",
    selected_sections: selected.map((section) => section.id),
    selected_assets: selectedAssets,
    message: args.title || args.goal,
  };
  const perScene = Math.max(4, Math.round(args.duration / Math.max(1, selected.length)));
  const scenes = selected.map((section, index) => ({
    id: `scene-${String(index + 1).padStart(3, "0")}`,
    title: section.title,
    duration_seconds: perScene,
    section_ids: [section.id],
    asset_ids: section.asset_ids ?? [],
    visual: {
      layout: section.asset_ids?.length ? "text-with-source-visual" : "typographic-card",
      motion: index === 0 ? "fade-in" : "slide-up",
      background: "light",
    },
    caption: section.title,
    narration: section.summary,
    notes: "Generated from document IR. Refine in HyperFrames/video-studio.",
  }));
  const timelineItems = [];
  let cursor = 0;
  for (const scene of scenes) {
    timelineItems.push({ scene_id: scene.id, start: cursor, end: cursor + scene.duration_seconds });
    cursor += scene.duration_seconds;
  }

  await writeJson(resolve(sessionRoot, "story/design_brief.json"), videoBrief);
  await writeJson(resolve(sessionRoot, "story/video_brief.json"), videoBrief);
  await writeJson(resolve(sessionRoot, "story/scenes.json"), {
    title: "Storyboard Scenes",
    schema_version: 1,
    created_at: createdAt,
    scenes,
  });
  await writeJson(resolve(sessionRoot, "story/narration.json"), {
    title: "Narration",
    schema_version: 1,
    created_at: createdAt,
    items: scenes.map((scene) => ({ scene_id: scene.id, text: scene.narration })),
  });
  await writeJson(resolve(sessionRoot, "story/timeline.json"), {
    title: "Video Timeline",
    schema_version: 1,
    created_at: createdAt,
    duration_seconds: cursor,
    tracks: [{ id: "track-visual", kind: "visual", items: timelineItems }],
  });
  return { videoBrief, scenes, selected, selectedAssets };
}

function renderVideoHtml(args, story, assetsManifest) {
  const assetById = new Map((assetsManifest.assets ?? []).map((asset) => [asset.id, asset]));
  const sceneHtml = story.scenes.map((scene, index) => {
    const asset = scene.asset_ids.map((id) => assetById.get(id)).find(Boolean);
    const image = asset ? `<img src="${escapeHtml(asset.path)}" alt="${escapeHtml(asset.title)}">` : "";
    return `<section class="scene" data-scene-id="${escapeHtml(scene.id)}" data-hf-id="${escapeHtml(scene.id)}">
      <div class="scene-index">${String(index + 1).padStart(2, "0")}</div>
      <div class="copy">
        <p class="eyebrow">Document Video</p>
        <h1>${escapeHtml(scene.caption)}</h1>
        <p>${escapeHtml(scene.narration)}</p>
      </div>
      ${image ? `<figure>${image}</figure>` : ""}
    </section>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(args.title || "Document Video")}</title>
  <style>
    :root { --ipw-color-bg: #f8fafc; --ipw-color-text: #0f172a; --ipw-color-muted: #64748b; --ipw-color-accent: #14b8a6; --ipw-font-body: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #dbe3ef; color: var(--ipw-color-text); font-family: var(--ipw-font-body); }
    main { display: grid; gap: 24px; padding: 24px; }
    .scene { position: relative; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(280px, .95fr); gap: 42px; align-items: center; min-height: min(100vh, 900px); aspect-ratio: 16 / 9; overflow: hidden; border-radius: 18px; background: linear-gradient(135deg, #ffffff 0%, #eef5ff 100%); box-shadow: 0 24px 80px rgba(15, 23, 42, .16); padding: 72px; }
    .scene::after { content: ""; position: absolute; inset: auto 0 0; height: 10px; background: var(--ipw-color-accent); }
    .scene-index { position: absolute; top: 34px; right: 42px; color: #cbd5e1; font-size: 64px; font-weight: 800; }
    .copy { position: relative; z-index: 1; max-width: 760px; }
    .eyebrow { margin: 0 0 16px; color: var(--ipw-color-accent); font-size: 15px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(42px, 7vw, 96px); line-height: .95; letter-spacing: 0; }
    .copy > p:last-child { margin: 28px 0 0; color: var(--ipw-color-muted); font-size: clamp(20px, 2.2vw, 34px); line-height: 1.35; }
    figure { position: relative; z-index: 1; margin: 0; display: grid; place-items: center; min-height: 420px; border: 1px solid rgba(15, 23, 42, .08); border-radius: 14px; background: rgba(255, 255, 255, .72); overflow: hidden; }
    img { max-width: 100%; max-height: 560px; object-fit: contain; }
    @media (max-width: 820px) { main { padding: 12px; } .scene { grid-template-columns: 1fr; aspect-ratio: auto; min-height: 720px; padding: 42px 28px; } figure { min-height: 260px; } }
  </style>
</head>
<body>
  <main data-composition-id="document-video" data-composition-file="index.html">
${sceneHtml}
  </main>
</body>
</html>
`;
}

function renderDesignHtml(args, story, assetsManifest) {
  const assetById = new Map((assetsManifest.assets ?? []).map((asset) => [asset.id, asset]));
  const selectedScenes = story.scenes.length ? story.scenes : [{ id: "scene-001", title: args.title, caption: args.title, narration: args.goal, asset_ids: [] }];
  const firstAsset = selectedScenes.flatMap((scene) => scene.asset_ids).map((id) => assetById.get(id)).find(Boolean);
  if (args.target === "slides") {
    const slides = selectedScenes.map((scene, index) => {
      const asset = scene.asset_ids.map((id) => assetById.get(id)).find(Boolean);
      return `<section data-ipw-slide data-slide-id="${escapeHtml(scene.id)}" class="slide">
        <p class="kicker" data-pptx-text>${String(index + 1).padStart(2, "0")} / Document Deck</p>
        <h1 data-pptx-text>${escapeHtml(scene.caption)}</h1>
        <p class="body" data-pptx-text>${escapeHtml(scene.narration)}</p>
        ${asset ? `<img data-pptx-image src="${escapeHtml(asset.path)}" alt="${escapeHtml(asset.title)}">` : `<div class="shape" data-pptx-shape="rect" aria-hidden="true"></div>`}
      </section>`;
    }).join("\n");
    return designShell(args, "deck", slides);
  }
  if (args.target === "poster") {
    const items = selectedScenes.slice(0, 4).map((scene) => `<article><h2>${escapeHtml(scene.caption)}</h2><p>${escapeHtml(scene.narration)}</p></article>`).join("\n");
    return designShell(args, "poster", `<main class="poster">
      <p class="kicker">Document Poster</p>
      <h1>${escapeHtml(args.title)}</h1>
      ${firstAsset ? `<img src="${escapeHtml(firstAsset.path)}" alt="${escapeHtml(firstAsset.title)}">` : ""}
      <section class="grid">${items}</section>
    </main>`);
  }
  const cards = selectedScenes.map((scene) => `<article><h2>${escapeHtml(scene.caption)}</h2><p>${escapeHtml(scene.narration)}</p></article>`).join("\n");
  return designShell(args, "document-design", `<main class="document-page">
    <header>
      <p class="kicker">Document ${escapeHtml(args.target)}</p>
      <h1>${escapeHtml(args.title)}</h1>
      <p>${escapeHtml(args.goal)}</p>
    </header>
    ${firstAsset ? `<img class="hero-image" src="${escapeHtml(firstAsset.path)}" alt="${escapeHtml(firstAsset.title)}">` : ""}
    <section class="grid">${cards}</section>
  </main>`);
}

function designShell(args, className, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(args.title || "Document Design")}</title>
  <style>
    :root { --ipw-color-bg: #f7f4ef; --ipw-color-text: #151515; --ipw-color-muted: #60646c; --ipw-color-accent: #0f766e; --ipw-font-body: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #e6e8ec; color: var(--ipw-color-text); font-family: var(--ipw-font-body); }
    .document-page, .poster, .slide { background: var(--ipw-color-bg); margin: 24px auto; width: min(1120px, calc(100vw - 32px)); padding: 64px; box-shadow: 0 24px 72px rgba(15, 23, 42, .14); }
    .slide { aspect-ratio: 16 / 9; display: grid; align-content: center; gap: 22px; overflow: hidden; }
    .poster { width: min(840px, calc(100vw - 32px)); min-height: 1188px; }
    .kicker { margin: 0 0 16px; color: var(--ipw-color-accent); font-size: 14px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(46px, 7vw, 88px); line-height: 1; letter-spacing: 0; }
    h2 { margin: 0 0 10px; font-size: 24px; }
    p { color: var(--ipw-color-muted); font-size: 20px; line-height: 1.45; }
    .body { max-width: 820px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; margin-top: 40px; }
    article { border-top: 2px solid var(--ipw-color-accent); padding-top: 18px; }
    img { max-width: 100%; max-height: 420px; object-fit: contain; border-radius: 10px; }
    .hero-image { display: block; margin: 36px 0 0; }
    .shape { width: min(520px, 100%); height: 220px; border-radius: 14px; background: linear-gradient(135deg, rgba(15,118,110,.18), rgba(15,23,42,.08)); }
    @media (max-width: 720px) { .document-page, .poster, .slide { padding: 34px 24px; } }
  </style>
</head>
<body class="${escapeHtml(className)}">
${body}
</body>
</html>
`;
}

async function writeDesignProject(input) {
  const { sessionRoot, args, sourceFile, documentIndex, assetsManifest, story, createdAt } = input;
  const target = targetConfigs[args.target];
  const coverSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#0f172a"/><text x="120" y="430" fill="#f8fafc" font-family="Arial, sans-serif" font-size="76" font-weight="700">${escapeHtml(args.title || "Document Video")}</text><text x="124" y="510" fill="#94a3b8" font-family="Arial, sans-serif" font-size="34">Generated from structured document IR</text></svg>\n`;
  await writeFile(resolve(sessionRoot, "cover.svg"), coverSvg, "utf8");
  await writeJson(resolve(sessionRoot, "brief.json"), {
    title: args.title || "Document Design",
    schema_version: 1,
    created_at: createdAt,
    mode: "document-to-design-compiler",
    target: args.target,
    goal: args.goal,
    source: sourceFile,
    document_index: "extracted/document_index.json",
    assets_manifest: "extracted/assets_manifest.json",
    story: {
      design_brief: "story/design_brief.json",
      scenes: "story/scenes.json",
      narration: "story/narration.json",
      timeline: "story/timeline.json",
    },
    selected_sections: story.selected.map((section) => section.id),
    selected_assets: story.selectedAssets,
    warnings: documentIndex.warnings,
  });
  await writeJson(resolve(sessionRoot, "manifest.json"), {
    schemaVersion: 1,
    id: `ipollowork.document-${target.category}.${args.session.toLowerCase().replace(/_/g, "-")}`,
    version: "0.1.0",
    kind: "design",
    category: target.category,
    subcategory: "document-to-design",
    style: target.style,
    tags: [target.category, "document", "compiler"],
    ...(target.pptxCompatibility ? { pptxCompatibility: target.pptxCompatibility } : {}),
    surface: target.surface,
    title: args.title || "Document Design",
    description: `Editable ${target.category} generated from document-to-design compiler IR.`,
    cover: "cover.svg",
    entry: target.entry,
    source: {
      name: "iPolloWork Document To Design Compiler",
      license: "SEE LICENSE IN LICENSE",
    },
    designSystem: {
      tokenVersion: 1,
      editableGroups: ["theme", "background", "typography", "components"],
      variables: [],
    },
    applyChecklist: [
      "Review selected source sections.",
      "Adjust visual hierarchy in iPolloWork Design.",
      "Run the relevant design or video validation before export.",
    ],
    minimumAppVersion: "0.18.0",
  });
  const html = args.target === "video"
    ? renderVideoHtml(args, story, assetsManifest)
    : renderDesignHtml(args, story, assetsManifest);
  await writeFile(resolve(sessionRoot, target.entry), html, "utf8");
}

async function compileDocumentToVideo(rawArgs) {
  const args = parseArguments(rawArgs);
  const createdAt = now();
  const workspace = resolve(args.workspace);
  const target = targetConfigs[args.target];
  const sessionRoot = resolve(workspace, target.folder, args.session);
  if (args.force) {
    await rm(resolve(sessionRoot, "extracted"), { recursive: true, force: true });
    await rm(resolve(sessionRoot, "story"), { recursive: true, force: true });
  }
  await mkdir(resolve(sessionRoot, "source"), { recursive: true });
  await mkdir(resolve(sessionRoot, "extracted/pages"), { recursive: true });
  await mkdir(resolve(sessionRoot, "extracted/sections"), { recursive: true });
  await mkdir(resolve(sessionRoot, "extracted/assets/images"), { recursive: true });
  await mkdir(resolve(sessionRoot, "story"), { recursive: true });

  let sourcePath = "";
  let sourceFile = "";
  if (!args.blank) {
    sourcePath = resolve(args.source);
    if (!existsSync(sourcePath)) throw new Error(`Source file does not exist: ${sourcePath}`);
    sourceFile = `source/${basename(sourcePath)}`;
    await copyFile(sourcePath, resolve(sessionRoot, sourceFile));
  }

  const extension = extname(sourcePath).toLowerCase();
  args.title = args.title || (sourcePath ? basename(sourcePath, extension) : "Blank video");

  const extraction = args.blank
    ? await extractBlank(args.goal)
    : extension === ".pdf"
      ? await extractPdf({ sessionRoot, sourcePath, sourceFile, createdAt })
      : [".pptx", ".pptm", ".potx"].includes(extension)
        ? await extractPptx({ sessionRoot, sourcePath, sourceFile, createdAt })
        : (() => { throw new Error(`Unsupported source type: ${extension || "(none)"}`); })();

  const sections = await buildSections({ sessionRoot, sourceFile, extraction, createdAt, goal: args.goal, title: args.title });
  const sectionByRange = new Map();
  for (const section of sections) {
    for (const page of section.pages ?? []) sectionByRange.set(`page:${page}`, section.id);
    for (const slide of section.slides ?? []) sectionByRange.set(`slide:${slide}`, section.id);
  }
  for (const item of extraction.coverage) {
    item.section_id = sectionByRange.get(`${item.kind}:${item.number}`) ?? sections[0]?.id ?? "";
  }

  const documentIndex = {
    title: "Document Index",
    schema_version: 1,
    created_at: createdAt,
    document: {
      id: "doc-001",
      title: args.title,
      kind: extraction.kind,
      source_path: sourceFile,
      page_count: extraction.pageCount,
      slide_count: extraction.slideCount,
      language: "unknown",
    },
    sections,
    warnings: extraction.warnings,
  };
  const coverageMatrix = {
    title: "Extraction Coverage Matrix",
    schema_version: 1,
    created_at: createdAt,
    items: extraction.coverage,
  };
  const assetsManifest = {
    title: "Extracted Assets Manifest",
    schema_version: 1,
    created_at: createdAt,
    assets: extraction.assets,
  };
  const story = await writeStory({ sessionRoot, sections, args, createdAt });
  for (const item of coverageMatrix.items) {
    item.used_in_story = story.selected.some((section) => section.id === item.section_id);
  }

  await writeJson(resolve(sessionRoot, "extracted/document_index.json"), documentIndex);
  await writeJson(resolve(sessionRoot, "extracted/coverage_matrix.json"), coverageMatrix);
  await writeJson(resolve(sessionRoot, "extracted/assets_manifest.json"), assetsManifest);
  await writeDesignProject({ sessionRoot, args, sourceFile, documentIndex, assetsManifest, story, createdAt });

  return {
    ok: true,
    session: args.session,
    target: args.target,
    project: relativePath(workspace, sessionRoot),
    document_index: relativePath(workspace, resolve(sessionRoot, "extracted/document_index.json")),
    sections: sections.length,
    assets: extraction.assets.length,
    warnings: extraction.warnings,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  compileDocumentToVideo(process.argv.slice(2))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

export { compileDocumentToVideo };

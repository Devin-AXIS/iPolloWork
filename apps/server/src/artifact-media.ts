import { createHash } from "node:crypto";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { z } from "zod";
import { ApiError } from "./errors.js";
import { resolveWithinRoot } from "./paths.js";
import { listSessionArtifacts, sessionArtifactOwner } from "./session-artifacts.js";
import { workspaceForContext } from "./extensions/storage.js";
import type { ServerConfig } from "./types.js";
import { uiControlRequest } from "./ui-control-client.js";

const needSchema = z.object({
  id: z.string().min(1).max(80),
  purpose: z.string().min(1).max(600),
  kind: z.enum(["image", "video", "reuse", "diagram"]),
}).strict();
const outcomeSchema = z.object({
  id: z.string(),
  status: z.enum(["generated", "reused", "diagram", "declined", "unavailable", "failed", "pending"]),
  path: z.string().optional(),
  generationPath: z.string().optional(),
  reason: z.string().max(1000).optional(),
}).strict();
const reviewSchema = z.object({
  phase: z.enum(["plan", "check"]),
  sourcePath: z.string(),
  needs: z.array(needSchema).max(24).optional(),
  exemption: z.enum(["explicit-text-only", "no-generation", "local-edit", "theme-only", "existing-assets", "diagrams-sufficient"]).optional(),
  reason: z.string().max(1000).optional(),
  outcomes: z.array(outcomeSchema).max(24).optional(),
}).strict();
const planSchema = z.object({
  sourcePath: z.string(),
  needs: z.array(needSchema),
  exemption: z.string().optional(),
  reason: z.string().optional(),
  createdAt: z.number(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const ARTIFACT_MEDIA_ACTION = {
  extensionId: "media",
  action: "artifact_media_review",
  title: "Plan and verify artifact media",
  description: "For initial template/custom Design, PPT or Video authoring, call phase=plan before layout with sourcePath and useful visual needs (id, purpose, kind=image/video/reuse/diagram). Saves the plan in existing brief.json and queries live capabilities for generated visuals; does not generate or select a model. An empty plan needs an explicit exemption and reason. Before final delivery call phase=check with an outcome for every planned id. Generated/reused outcomes need project-relative path; generated copies also need the original workspace-relative generationPath returned by the generator. Checks nonempty local files, HTML/CSS references and real session generation receipts. Missing/pending assets fail completion; reported declined/unavailable/failed assets are partial delivery, not successful generation. Visual quality and playback still require preview inspection.",
  effect: "write" as const,
  inputSchema: z.toJSONSchema(reviewSchema),
};

const previewReviewSchema = z.object({
  sourcePath: z.string(),
  kind: z.enum(["site", "slides"]),
}).strict();

export const ARTIFACT_PREVIEW_REVIEW_ACTION = {
  extensionId: "media",
  action: "artifact_preview_review",
  title: "Preview and batch-review a website or presentation",
  description: "The only supported visual acceptance entry for Design websites and presentations. The running iPolloWork client loads the exact workspace HTML with the same Design preview runtime and hydrated local assets. Websites are reviewed once at desktop and mobile sizes; presentations are reviewed in one batch across every recognized slide. Do not start a temporary HTTP server, open generic browser tabs, create helper preview HTML, or take one screenshot per slide. Call once after authoring, then call again only after fixing reported issues.",
  effect: "write" as const,
  inputSchema: z.toJSONSchema(previewReviewSchema),
};

export async function reviewArtifactPreview(
  config: ServerConfig,
  input: unknown,
  context: Record<string, unknown>,
  runClientReview: (input: { workspaceId: string; sourcePath: string; kind: "site" | "slides" }) => Promise<unknown> = (review) => uiControlRequest("/execute", {
    method: "POST",
    timeoutMs: 120_000,
    body: { actionId: "design.preview_review", args: review },
  }),
) {
  const args = previewReviewSchema.parse(input);
  const workspace = workspaceForContext(config, context, { strictWorkspaceId: true });
  const rootMatch = /^design\/([^/]+)\/.+\.html$/i.exec(args.sourcePath);
  if (!rootMatch) {
    throw new ApiError(400, "preview_review_owner", "sourcePath must be the active session's Design HTML entry");
  }
  const sessionRoot = await resolveWithinRoot(workspace.path, "design", sessionArtifactOwner(rootMatch[1]));
  await boundedRead(await resolveWithinRoot(workspace.path, args.sourcePath));
  const briefPath = await resolveWithinRoot(sessionRoot, "brief.json");
  const brief = z.record(z.string(), z.unknown()).parse(JSON.parse((await boundedRead(briefPath)).toString()));
  const response = await runClientReview({ workspaceId: workspace.id, sourcePath: args.sourcePath, kind: args.kind });
  if (!isRecord(response) || response.ok !== true) {
    throw new ApiError(409, "preview_review_unavailable", "Open this workspace in the running iPolloWork client, then retry the single preview review action", { response });
  }
  const result = isRecord(response.result) ? response.result : response;
  if (config.readOnly) throw new ApiError(403, "read_only", "Cannot save preview acceptance in a read-only workspace");
  await writeFile(briefPath, JSON.stringify({
    ...brief,
    previewReview: {
      sourcePath: args.sourcePath,
      kind: args.kind,
      reviewedAt: Date.now(),
      result,
    },
  }, null, 2) + "\n");
  return { ok: true, result };
}

async function boundedRead(path: string, maxBytes = 2 * 1024 * 1024) {
  const info = await stat(path);
  if (!info.isFile() || info.size > maxBytes) throw new ApiError(400, "media_review_file_size", "Media review input must be a bounded regular file");
  return readFile(path);
}

// Match URLs only in CSS, not in quoted copy such as content:"url(example)".
function cssReferences(css: string) {
  const media: string[] = [];
  const styles: string[] = [];
  const active = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of active.matchAll(/@import\s+(?:url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)|"[^"]*"|'[^']*')|url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gi)) {
    const token = match[0];
    if (/^["']/.test(token)) continue;
    const isImport = /^@import\b/i.test(token);
    const value = token.replace(/^@import\s+/i, "").replace(/^url\(\s*|\s*\)$/gi, "").trim().replace(/^["']|["']$/g, "");
    (isImport ? styles : media).push(value);
  }
  return { media, styles };
}

function htmlAttributes(source: string) {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    const value = (match[2] ?? match[3] ?? match[4]).replace(/&(?:amp|quot|apos|lt|gt);|&#(?:x[\da-f]+|\d+);/gi, (entity) => {
      const named: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">" };
      const key = entity.toLowerCase();
      if (key in named) return named[key];
      const code = key.startsWith("&#x") ? Number.parseInt(key.slice(3), 16) : Number.parseInt(key.slice(2), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd";
    });
    attributes.set(match[1].toLowerCase(), value);
  }
  return attributes;
}

async function collectArtifactReferences(source: string, sessionRoot: string) {
  const referenced = new Set<string>();
  const issues: string[] = [];
  const seenStyles = new Set<string>();
  let bytesRead = 0;
  let urlCount = 0;
  const localPath = async (url: string, directory: string) => {
    if (++urlCount > 512) throw new ApiError(400, "media_review_references", "Too many local references for media review; simplify the entry or split the video");
    const value = url.trim();
    if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)) return null;
    let path: string;
    try { path = decodeURIComponent(value.split(/[?#]/)[0]); }
    catch { throw new ApiError(400, "media_review_url", "Media reference contains invalid URL encoding"); }
    const candidate = await resolveWithinRoot(sessionRoot, relative(sessionRoot, resolve(directory, path)));
    return realpath(candidate).catch(() => candidate);
  };
  const read = async (path: string, kind: string) => {
    try {
      const bytes = await boundedRead(path);
      bytesRead += bytes.length;
      if (bytesRead > 8 * 1024 * 1024) throw new ApiError(400, "media_review_total_size", "Media review dependencies exceed 8 MB; simplify the composition or stylesheets");
      return bytes.toString();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      issues.push(`missing_${kind}: ${relative(sessionRoot, path).replaceAll("\\", "/")}`);
      return null;
    }
  };
  const collectCss = async (css: string, directoryFor: (url: string) => string): Promise<void> => {
    const refs = cssReferences(css);
    for (const url of refs.media) {
      const path = await localPath(url, directoryFor(url));
      if (path) referenced.add(path);
    }
    for (const url of refs.styles) await stylesheet(url, directoryFor(url));
  };
  const stylesheet = async (url: string, directory: string): Promise<void> => {
    const path = await localPath(url, directory);
    if (!path || seenStyles.has(path)) return;
    if (seenStyles.size >= 12) throw new ApiError(400, "media_review_styles", "Too many stylesheets for bounded media review");
    seenStyles.add(path);
    const css = await read(path, "stylesheet");
    if (css !== null) await collectCss(css, () => dirname(path));
  };
  const inspectHtml = async (html: string, path: string, compositionId?: string) => {
    const active = html.replace(/<!--[\s\S]*?-->|<(script|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
    const templates = [...active.matchAll(/<template\b([^>]*)>([\s\S]*?)<\/template\s*>/gi)];
    const template = compositionId !== undefined ? templates.find(match => htmlAttributes(match[1]).get("id") === `${compositionId}-template`) ?? templates[0] : undefined;
    const head = active.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1] ?? "";
    const headLinks = [...head.matchAll(/<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)].map(match => match[0]).join("");
    // The loader keeps head links even when it mounts a template, but does
    // not mount unrelated templates or head styles from that document.
    const markup = template ? `<head>${headLinks}</head>${template[2]}` : active.replace(/<template\b[^>]*>[\s\S]*?<\/template\s*>/gi, "");
    // HyperFrames mounts child HTML into the entry. Only ../ paths are
    // rewritten against the child; plain assets/... stays entry-relative.
    const directoryFor = (url: string) => compositionId !== undefined && url.trim().startsWith("../") ? dirname(path) : dirname(source);
    for (const style of markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) await collectCss(style[1], directoryFor);
    const compositions: Array<{ url: string; id: string; inline?: string }> = [];
    const tags = markup.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
    const headEnd = tags.search(/<\/head\s*>/i);
    for (const tag of tags.matchAll(/<([a-z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
      const name = tag[1].toLowerCase();
      const attrs = htmlAttributes(tag[2]);
      const media = /^(?:img|video|source)$/.test(name) ? [attrs.get("src"), name === "video" ? attrs.get("poster") : undefined] : [];
      for (const url of media) {
        if (!url) continue;
        const asset = await localPath(url, directoryFor(url));
        if (asset) referenced.add(asset);
      }
      if (attrs.has("style")) await collectCss(attrs.get("style")!, directoryFor);
      if (name === "link" && attrs.get("rel")?.toLowerCase().split(/\s+/).includes("stylesheet")) {
        const href = attrs.get("href");
        if (href) await stylesheet(href, compositionId !== undefined && tag.index < headEnd ? dirname(path) : directoryFor(href));
      }
      const url = attrs.get("data-composition-src");
      // Runtime discovers hosts once before mounting: nested new hosts and
      // arbitrary data-variable-values do not prove rendered media usage.
      if (url && compositionId === undefined) {
        const id = attrs.get("data-composition-id") ?? "";
        const localTemplate = id ? templates.find(match => htmlAttributes(match[1]).get("id") === `${id}-template`) : undefined;
        compositions.push({ url, id, inline: localTemplate?.[2] });
      }
    }
    return compositions;
  };
  const html = await read(source, "source");
  if (html === null) return { referenced, issues };
  const compositions = await inspectHtml(html, source);
  if (compositions.length > 32) throw new ApiError(400, "media_review_compositions", "Too many composition hosts for bounded media review");
  const seenCompositions = new Set<string>();
  for (const { url, id, inline } of compositions) {
    // A local matching template takes precedence over an external file.
    if (inline !== undefined) {
      await inspectHtml(inline, source, id);
      continue;
    }
    const path = await localPath(url, dirname(source));
    if (!path || seenCompositions.has(`${path}\0${id}`)) continue;
    seenCompositions.add(`${path}\0${id}`);
    const child = await read(path, "composition");
    if (child !== null) await inspectHtml(child, path, id);
  }
  return { referenced, issues };
}

export async function reviewArtifactMedia(
  config: ServerConfig,
  input: unknown,
  context: Record<string, unknown>,
  query: (extensionId: string) => Promise<unknown>,
) {
  const args = reviewSchema.parse(input);
  const workspace = workspaceForContext(config, context, { strictWorkspaceId: true });
  const rootMatch = /^(design|video)\/([^/]+)\//.exec(args.sourcePath);
  if (!rootMatch || !args.sourcePath.endsWith(".html")) {
    throw new ApiError(400, "media_review_owner", "sourcePath must be the active session's design/video HTML entry");
  }
  // Some engine MCP transports omit session metadata. The explicit artifact
  // directory still identifies its owner; never guess from a workspace's
  // most recently active conversation (parallel tasks may be running).
  const projectId = sessionArtifactOwner(rootMatch[2]);
  const sessionId = sessionArtifactOwner(projectId.replace(/-artifact-(?:site|video|app|slides|poster|cards|report|article|other)(?:-\d+)?$/, ""));
  if (context.sessionId !== undefined && sessionArtifactOwner(context.sessionId) !== sessionId) {
    throw new ApiError(400, "media_review_owner", "sourcePath must belong to the calling session");
  }
  const sessionRoot = await resolveWithinRoot(workspace.path, rootMatch[1], sessionArtifactOwner(rootMatch[2]));
  const projectPrefix = `${rootMatch[1]}/${rootMatch[2]}/`;
  let source: string;
  try {
    const sourceCandidate = await resolveWithinRoot(workspace.path, args.sourcePath);
    source = await realpath(await resolveWithinRoot(sessionRoot, relative(sessionRoot, sourceCandidate)));
    await boundedRead(source);
  } catch (error) {
    if (args.phase === "check" && !(error instanceof ApiError)) {
      return { ok: true, result: { complete: false, fileCanBeDelivered: false, issues: ["missing_source"], next: "Restore the planned HTML entry before delivering the artifact" } };
    }
    throw error;
  }
  const briefPath = await resolveWithinRoot(sessionRoot, "brief.json");
  const brief = z.record(z.string(), z.unknown()).parse(JSON.parse((await boundedRead(briefPath)).toString()));
  if (args.phase === "plan") {
    if (config.readOnly) throw new ApiError(403, "read_only", "Cannot save a media plan in a read-only workspace");
    const needs = args.needs ?? [];
    if ((!needs.length && (!args.exemption || !args.reason?.trim())) || new Set(needs.map(need => need.id)).size !== needs.length) {
      throw new ApiError(400, "media_plan_invalid", "Use unique need ids; an empty plan requires an exemption and reason");
    }
    // Keep unresolved needs across retries instead of letting a second empty
    // plan silently turn a missing asset into a successful text-only delivery.
    if (brief.mediaPlan) {
      const existing = planSchema.parse(brief.mediaPlan);
      if (existing.needs.some(need => !needs.some(candidate => JSON.stringify(candidate) === JSON.stringify(need)))) throw new ApiError(409, "media_plan_exists", "A media plan already exists; resolve each existing need in phase=check rather than discarding it");
    }
    const capabilities = [];
    for (const kind of new Set(needs.map(need => need.kind).filter(kind => kind === "image" || kind === "video"))) {
      try {
        capabilities.push({ kind, status: "queried", response: await query(kind === "image" ? "openai-image-generation" : "video-generation") });
      } catch {
        capabilities.push({ kind, status: "unknown", message: "Capability query failed; this does not prove missing authorization. Continue the file and report uncertainty." });
      }
    }
    const plan = { sourcePath: args.sourcePath, needs, exemption: args.exemption, reason: args.reason, createdAt: brief.mediaPlan ? planSchema.parse(brief.mediaPlan).createdAt : Date.now() };
    await writeFile(briefPath, JSON.stringify({ ...brief, mediaPlan: plan }, null, 2) + "\n");
    return { ok: true, result: { plan, capabilities, next: "Resolve model selection, then generate/reuse and place assets. Call phase=check before final delivery." } };
  }

  if (!brief.mediaPlan) return { ok: true, result: { complete: false, fileCanBeDelivered: false, issues: ["missing_media_plan"], next: "Call phase=plan before completing this artifact" } };
  const plan = planSchema.parse(brief.mediaPlan);
  if (plan.sourcePath !== args.sourcePath) throw new ApiError(400, "media_review_entry", "Check the entry recorded in the media plan");
  const { referenced, issues } = await collectArtifactReferences(source, sessionRoot);
  const outcomes = args.outcomes ?? z.array(outcomeSchema).parse(brief.mediaOutcomes ?? []);
  const resolveAssetPath = (value: string) => value.replaceAll("\\", "/").startsWith(projectPrefix)
    ? resolveWithinRoot(workspace.path, value)
    : resolveWithinRoot(sessionRoot, value);
  const reports: string[] = [];
  if (new Set(outcomes.map(item => item.id)).size !== outcomes.length || outcomes.some(item => !plan.needs.some(need => need.id === item.id))) issues.push("unexpected_or_duplicate_outcome");
  for (const need of plan.needs) {
    const outcome = outcomes.find(item => item.id === need.id);
    if (!outcome || outcome.status === "pending") { issues.push(`${need.id}: pending`); continue; }
    if (["declined", "unavailable", "failed"].includes(outcome.status)) {
      if (!outcome.reason?.trim()) issues.push(`${need.id}: missing_outcome_reason`);
      // These are disclosures, not independently verified provider/consent
      // evidence. Never convert a reported fallback into successful media.
      reports.push(`${need.id}: ${outcome.status}: ${outcome.reason ?? ""}`);
      continue;
    }
    if (outcome.status === "diagram") {
      if (need.kind !== "diagram") issues.push(`${need.id}: planned_imagery_replaced_by_diagram`);
      continue;
    }
    if (!outcome.path) { issues.push(`${need.id}: missing_asset_path`); continue; }
    const assetPath = await resolveAssetPath(outcome.path);
    const asset = await realpath(assetPath).catch(() => assetPath);
    let bytes: Buffer;
    try { bytes = await boundedRead(asset, 100 * 1024 * 1024); }
    catch { issues.push(`${need.id}: missing_or_invalid_file`); continue; }
    if (!bytes.length || !referenced.has(asset)) { issues.push(`${need.id}: empty_or_unreferenced_asset`); continue; }
    if (outcome.status !== "generated") continue;
    const generatedPath = outcome.generationPath ?? relative(await realpath(workspace.path), asset).replaceAll("\\", "/");
    let cursor: number | null = null;
    let pages = 0;
    let receipt;
    do {
      const page = await listSessionArtifacts(config, workspace.id, sessionId, cursor);
      receipt = page.items.find(item => item.path === generatedPath && item.generation && item.generation.completedAt >= plan.createdAt && (need.kind !== "image" && need.kind !== "video" || item.generation.kind === need.kind));
      cursor = page.nextCursor;
    } while (!receipt && cursor !== null && ++pages < 10);
    if (!receipt) { issues.push(`${need.id}: missing_generation_receipt`); continue; }
    try {
      const original = await boundedRead(await resolveWithinRoot(workspace.path, generatedPath), 100 * 1024 * 1024);
      if (createHash("sha256").update(original).digest("hex") !== createHash("sha256").update(bytes).digest("hex")) issues.push(`${need.id}: generated_file_mismatch`);
    } catch { issues.push(`${need.id}: missing_generated_original`); }
  }
  if (args.outcomes) {
    if (config.readOnly) throw new ApiError(403, "read_only", "Cannot save media outcomes in a read-only workspace");
    await writeFile(briefPath, JSON.stringify({ ...brief, mediaOutcomes: outcomes }, null, 2) + "\n");
  }
  return { ok: true, result: { complete: issues.length === 0 && reports.length === 0, fileCanBeDelivered: issues.length === 0, issues, reportedFallbacks: reports, scope: "Saved files, local references and generation receipts only; verify rendered relevance, cropping, visibility and playback separately." } };
}

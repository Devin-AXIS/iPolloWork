import { createHash } from "node:crypto";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { z } from "zod";
import { ApiError } from "./errors.js";
import { resolveWithinRoot } from "./paths.js";
import { listSessionArtifacts, sessionArtifactOwner } from "./session-artifacts.js";
import { workspaceForContext } from "./extensions/storage.js";
import type { ServerConfig } from "./types.js";

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

export const ARTIFACT_MEDIA_ACTION = {
  extensionId: "media",
  action: "artifact_media_review",
  title: "Plan and verify artifact media",
  description: "For initial template/custom Design, PPT or Video authoring, call phase=plan before layout with sourcePath and useful visual needs (id, purpose, kind=image/video/reuse/diagram). Saves the plan in existing brief.json and queries live capabilities for generated visuals; does not generate or select a model. An empty plan needs an explicit exemption and reason. Before final delivery call phase=check with an outcome for every planned id. Generated/reused outcomes need project-relative path; generated copies also need the original workspace-relative generationPath returned by the generator. Checks nonempty local files, HTML/CSS references and real session generation receipts. Missing/pending assets fail completion; reported declined/unavailable/failed assets are partial delivery, not successful generation. Visual quality and playback still require preview inspection.",
  effect: "write" as const,
  inputSchema: z.toJSONSchema(reviewSchema),
};

async function boundedRead(path: string, maxBytes = 2 * 1024 * 1024) {
  const info = await stat(path);
  if (!info.isFile() || info.size > maxBytes) throw new ApiError(400, "media_review_file_size", "Media review input must be a bounded regular file");
  return readFile(path);
}

// Only actual URL-bearing attributes/styles count. Mentioning a filename in
// copy, comments, scripts or an alt label is not placement in the document.
function mediaUrls(text: string) {
  const content = text.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  return [
    ...Array.from(content.matchAll(/<(?:img|video|source)\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi), match => match[1]),
    ...Array.from(content.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gi), match => match[1]),
  ];
}

export async function reviewArtifactMedia(
  config: ServerConfig,
  input: unknown,
  context: Record<string, unknown>,
  query: (extensionId: string) => Promise<unknown>,
) {
  const args = reviewSchema.parse(input);
  const workspace = workspaceForContext(config, context);
  const sessionId = sessionArtifactOwner(context.sessionId);
  const rootMatch = /^(design|video)\/([^/]+)\//.exec(args.sourcePath);
  if (!rootMatch || !args.sourcePath.endsWith(".html")) {
    throw new ApiError(400, "media_review_owner", "sourcePath must be the active session's design/video HTML entry");
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
  const html = (await boundedRead(source)).toString();
  const referenced = new Set<string>();
  const collect = async (text: string, directory: string) => {
    for (const url of mediaUrls(text)) {
      if (/^(?:[a-z]+:|\/\/|#)/i.test(url)) continue;
      const path = decodeURIComponent(url.split(/[?#]/)[0]);
      referenced.add(await resolveWithinRoot(sessionRoot, relative(sessionRoot, resolve(directory, path))));
    }
  };
  await collect(html, dirname(source));
  const styles = Array.from(html.matchAll(/<link\b[^>]*\bhref=["']([^"']+\.css)["'][^>]*>/gi), match => match[1]);
  if (styles.length > 12) throw new ApiError(400, "media_review_styles", "Too many stylesheets for bounded media review");
  for (const path of styles) {
    if (/^(?:[a-z]+:|\/\/)/i.test(path)) continue;
    const css = await resolveWithinRoot(sessionRoot, relative(sessionRoot, resolve(dirname(source), path)));
    await collect((await boundedRead(css)).toString(), dirname(css));
  }
  const outcomes = args.outcomes ?? z.array(outcomeSchema).parse(brief.mediaOutcomes ?? []);
  const resolveAssetPath = (value: string) => value.replaceAll("\\", "/").startsWith(projectPrefix)
    ? resolveWithinRoot(workspace.path, value)
    : resolveWithinRoot(sessionRoot, value);
  const issues: string[] = [];
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

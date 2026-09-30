import type { TemplateManifestV1 } from "@ipollowork/types/templates";
import type { VideoDeliveryRequirements } from "@ipollowork/types/hyperframes-project";
export type { VideoDeliveryRequirements } from "@ipollowork/types/hyperframes-project";
import {
  hyperframesStudioUrl,
  hyperframesStudioPort,
  videoProjectDirectory,
  videoProjectId,
  videoProjectEntryPath,
} from "@ipollowork/video-studio/project";
import { TEMPLATE_LAYOUT_ADAPTATION_CONTRACT } from "../templates/template-brief";
import { artifactContentFingerprint } from "../artifacts/artifact-completion";
import { VIDEO_STORYBOARD_FORMAT_CONTRACT } from "./video-storyboard";

export {
  hyperframesStudioPort,
  hyperframesStudioUrl,
  videoProjectDirectory,
  videoProjectEntryPath,
  videoProjectId,
};

export const HYPERFRAMES_STUDIO_LABEL = "Local HyperFrames Studio";

export function videoProjectSessionIdFromEntryPath(path: string) {
  const match = /^video\/([^/]+)\/index\.html$/i.exec(path.trim().replaceAll("\\", "/").replace(/^\.\//, ""));
  return match?.[1] ?? null;
}

/**
 * Template metadata is authoritative when it exists. Older sessions created
 * before template-session persistence still have their surface in the
 * renderer's session cache, so use that cache only as a null-metadata
 * fallback. This keeps an old Video Studio session on its session-owned
 * project without allowing a stale cache to override persisted metadata.
 */
export function shouldInjectVideoTaskContext(
  templateSurface: string | null | undefined,
  cachedSessionType: string | null | undefined,
) {
  return templateSurface === "video" || (templateSurface == null && cachedSessionType === "video");
}

export function videoPromptRequestsVoiceoverContext(capabilityId?: string, promptText?: string) {
  if (capabilityId === "video-voice-reference" || capabilityId === "video-delivery-recovery" || capabilityId === "video-storyboard-regeneration") return true;
  return /(?:配音|旁白|解说|语音合成|口播|voice[ -]?over|narrat(?:e|ion)|dub(?:bing)?|text[ -]?to[ -]?speech|\btts\b)/i.test(promptText ?? "");
}

const CHINESE_DURATION_VALUES: Record<string, number> = {
  "半": 0.5,
  "一": 1,
  "二": 2,
  "两": 2,
  "三": 3,
  "四": 4,
  "五": 5,
  "六": 6,
  "七": 7,
  "八": 8,
  "九": 9,
  "十": 10,
};

const ENGLISH_DURATION_VALUES: Record<string, number> = {
  half: 0.5,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function durationValue(value: string) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return CHINESE_DURATION_VALUES[value] ?? ENGLISH_DURATION_VALUES[value.toLowerCase()] ?? null;
}

/** Extract the user's requested final video duration from ordinary Chinese or English. */
export function requestedVideoDurationSeconds(promptText?: string) {
  const text = promptText ?? "";
  const candidates: Array<{ index: number; seconds: number }> = [];
  const patterns = [
    { expression: /(\d+(?:\.\d+)?|半|一|二|两|三|四|五|六|七|八|九|十)\s*(?:分钟|分鐘|分)/gi, multiplier: 60 },
    { expression: /(\d+(?:\.\d+)?)\s*(?:秒钟|秒鐘|秒)/gi, multiplier: 1 },
    { expression: /(\d+(?:\.\d+)?|half|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:minutes?|mins?\.?)/gi, multiplier: 60 },
    { expression: /(\d+(?:\.\d+)?)\s*(?:seconds?|secs?\.?)/gi, multiplier: 1 },
  ];
  for (const { expression, multiplier } of patterns) {
    for (const match of text.matchAll(expression)) {
      const value = durationValue(match[1] ?? "");
      if (value != null && value > 0) candidates.push({ index: match.index ?? 0, seconds: value * multiplier });
    }
  }
  const latest = candidates.sort((left, right) => right.index - left.index)[0];
  return latest ? Math.round(latest.seconds * 1000) / 1000 : undefined;
}

export function videoDeliveryRequirementsForPrompt(input: {
  capabilityId?: string;
  promptText?: string;
  animationReferences?: readonly string[];
  voiceoverEnabled?: boolean;
  voiceoverAvailable?: boolean;
}): VideoDeliveryRequirements {
  const text = input.promptText ?? "";
  const targetDurationSeconds = requestedVideoDurationSeconds(text);
  const voiceoverExplicitlyDisabled = /(?:不要|无需|关闭|禁用|去掉)(?:旁白|配音)|(?:no|without|disable|mute)\s+(?:voice[ -]?over|narration|tts)/i.test(text);
  const requestsAudio = (terms: RegExp, defaultRequested = false) => {
    let requested = defaultRequested;
    for (const match of text.matchAll(terms)) {
      const prefix = text.slice(0, match.index);
      requested = !/(?:不要|不用|不需要|无需|无|無|关闭|禁用|去掉|取消|不加|移除|删除|\bno|\bwithout|\bdisable|\bremove|\bmute|\bdo not add|\bdon['’]t add)\s*(?:任何|所有|添加|加入|加|any)?\s*$/i.test(prefix);
    }
    return requested;
  };
  // Default finished-video sound design belongs to the delivery contract, not
  // just the model's prompt. Planning and local edits must not add new tracks.
  const planningOnly = /(?:只|仅|先).{0,12}(?:脚本|分镜|规划)|(?:先别|不要|暂不).{0,8}(?:生成|制作|做)(?:视频|成片)|(?:only|just).{0,16}(?:script|storyboard|plan)|(?:script|storyboard|plan)[ -]only/i.test(text);
  const createsVideo = /(?:制作|生成|创作|创建).{0,60}(?:视频|短片|宣传片|广告片)|(?:做)(?!\s*(?:配音|旁白|字幕))[\s\S]{0,60}(?:视频|短片|宣传片|广告片)|\b(?:make|create|produce|generate)\b.{0,80}\b(?:video|film|promo|commercial|explainer)\b/i.test(text);
  const explicitNoMotion = /(?:不要|无需|不需要|关闭|禁用|去掉|取消|不加|无).{0,12}(?:动画|运镜|镜头运动|空间镜头|motion|camera movement|animation)|(?:静态|固定镜头|fixed camera|static video)/i.test(text);
  const spatialCameraRequired = !planningOnly && !explicitNoMotion && (
    createsVideo || /(?:动画|运镜|镜头|空间镜头|shotcraft|spatial camera|camera journey)/i.test(text)
  );
  const silenceRequested = /(?:静音|无声|无音乐|無音樂|仅保留原声|只保留原声)|\b(?:silent|music-free|original[ -]sound[ -]only)\b/i.test(text);
  return {
    // Provider availability is an execution constraint, not user intent. If a
    // finished video has narration in its brief, keep it in the delivery
    // contract so validation cannot silently accept a narration-free result.
    voiceover: voiceoverExplicitlyDisabled
      || (input.voiceoverAvailable !== false && input.voiceoverEnabled === false)
      ? false
      : videoPromptRequestsVoiceoverContext(input.capabilityId, text)
        || (input.voiceoverAvailable === false && createsVideo)
        || (input.voiceoverEnabled ?? true),
    captions: /(?:字幕|caption(?:s|ing)?|subtitles?)/i.test(text),
    bgm: !planningOnly && !silenceRequested && requestsAudio(/(?:背景音乐|背景音樂|配乐|配樂|音乐|音樂|\bbgm\b|background music|music bed|\bmusic\b|soundtrack)/gi, createsVideo),
    sfx: requestsAudio(/(?:音效|\bsfx\b|sound[ -]?effects?)/gi),
    // ShotCraft is a per-video production requirement, not a global switch.
    animationReferences: Array.from(new Set([
      ...(spatialCameraRequired ? ["spatial-camera-suite"] : []),
      ...(input.animationReferences ?? []).filter(Boolean),
    ])),
    ...(targetDurationSeconds != null ? { targetDurationSeconds } : {}),
  };
}

export type VideoDeliveryIntent = "export" | "publish-douyin" | "publish-wechat-channels";

export function publicationUserInterventionRequired(text: string) {
  return text.split(/\r?\n/u).some((line) => {
    const candidate = line.trim();
    if (!candidate) return false;
    return /^(?:请(?:你|先|在)?.{0,40}(?:登录|扫码|输入验证码)|需要你.{0,30}(?:登录|扫码|输入验证码)|(?:(?:当前|视频号|微信视频号|官方)\s*)?页面(?:仍然?)?(?:停留在|显示|提示|要求).{0,30}(?:登录|扫码|验证码|加载失败)|captcha(?:\s+challenge)?|verification code required|sign[ -]?in required|log[ -]?in required)/i.test(candidate);
  });
}

export function videoDeliveryIntentForPrompt(promptText: string): VideoDeliveryIntent | null {
  const publicationCancelled = /(?:不要|无需|不必|别|取消)(?:发布|上传|发到|发至)|(?:do not|don't|without|no need to).{0,12}(?:publish|upload|post)/i.test(promptText);
  if (!publicationCancelled
    && /(?:发布|上传|发到|发至|发).{0,12}抖音|抖音.{0,12}(?:发布|上传)|(?:publish|upload|post).{0,20}douyin|douyin.{0,20}(?:publish|upload|post)/i.test(promptText)) return "publish-douyin";
  if (!publicationCancelled
    && /(?:发布|上传|发到|发至|发).{0,12}(?:微信)?视频号|(?:微信)?视频号.{0,12}(?:发布|上传)|(?:publish|upload|post).{0,20}wechat channels|wechat channels.{0,20}(?:publish|upload|post)/i.test(promptText)) return "publish-wechat-channels";
  if (/(?:不要|无需|不必|别|取消)导出|(?:do not|don't|without|no need to).{0,12}export/i.test(promptText)) return null;
  return /(?:导出|输出|生成).{0,12}(?:mp4|视频文件)|(?:mp4|视频文件).{0,12}(?:导出|输出|生成)|\b(?:export|render)\b.{0,20}(?:mp4|video)/i.test(promptText)
    ? "export"
    : null;
}

export function videoHostExportOperationKey(sessionId: string, requestId: string) {
  const stableRequestId = requestId.trim().replace(/[^a-z0-9_-]+/gi, "-") || "request";
  return `ipw:${sessionId}:${stableRequestId}:export`;
}

export type VideoArtifactCompletionRequirement = {
  sourcePath: string;
  baselineFingerprint: string;
  assistantMessageBaseline: number;
  requestOrdinal: number;
};

export function createVideoArtifactCompletionRequirement(
  sourcePath: string,
  content: string,
  assistantMessageBaseline: number,
  requestOrdinal: number,
): VideoArtifactCompletionRequirement {
  return {
    sourcePath,
    baselineFingerprint: artifactContentFingerprint(content),
    assistantMessageBaseline,
    requestOrdinal,
  };
}

export function unchangedVideoArtifactIssue(beforeFingerprint: string | null, after: string) {
  if (beforeFingerprint === null || beforeFingerprint !== artifactContentFingerprint(after)) return null;
  return {
    code: "artifact_unchanged",
    message: "The video source was not modified before the run ended.",
  };
}

export function videoCompositionHasVoiceover(content?: string | null) {
  if (!content) return false;
  return /<audio\b[^>]*(?:data-ipw-voiceover\s*=\s*["']true["']|id\s*=\s*["'](?:voiceover|vo-|narration-)|src\s*=\s*["'][^"']*(?:voiceover[-_]|\/audio\/(?:voice|narration)))/i.test(content);
}

/**
 * The agent's task workspace can be nested below the visible workspace root.
 * Give it the resolved Studio path instead of relying on its current directory
 * so both surfaces edit the same session-owned composition.
 */
export function videoProjectPath(sessionId: string, workspaceRoot?: string) {
  const projectDirectory = videoProjectDirectory(sessionId);
  const rawRoot = workspaceRoot?.trim();
  if (!rawRoot) return projectDirectory;
  const separator = rawRoot.includes("\\") ? "\\" : "/";
  const root = rawRoot.replace(/[\\/]+$/, "") || separator;
  const suffix = projectDirectory.replace(/\//g, separator);
  return root === separator ? `${separator}${suffix}` : `${root}${separator}${suffix}`;
}

/**
 * Every video task has one editable HyperFrames project. Keeping this prompt
 * beside the path helpers makes the chat contract and the right-side Studio
 * use the same session key instead of letting the agent choose an unrelated
 * directory.
 */
export function videoTaskSystemContext(
  sessionId: string,
  workspaceRoot?: string,
  template?: Pick<TemplateManifestV1, "id" | "title" | "entry" | "applyChecklist" | "authoringGuide" | "layoutLibrary"> | null,
  options: { includeVoiceover?: boolean; deliveryRequirements?: VideoDeliveryRequirements; hostManagedExport?: boolean; hostExportOperationKey?: string } = {},
) {
  const hostManagedExport = options.hostManagedExport || Boolean(options.hostExportOperationKey);
  const projectDirectory = videoProjectDirectory(sessionId);
  const projectPath = videoProjectPath(sessionId, workspaceRoot);
  const studioPort = hyperframesStudioPort(sessionId);
  const baseContract = [
    "Video task contract:",
    "- The requested deliverable is an editable HyperFrames HTML video for Video Studio. A request to export MP4 still retains this source. Do not replace the composition with a plugin-generated clip or request a video model selection unless the user explicitly asks for generated footage; footage needed as an intermediate asset must be integrated into the finished composition.",
    `- Own only \`${projectPath}\`; Video Studio displays \`${projectPath}/index.html\` at \`http://localhost:${studioPort}\` and hot-reloads saves.`,
    ...(template ? [
      TEMPLATE_LAYOUT_ADAPTATION_CONTRACT,
      ...(template.layoutLibrary ? [`- Read ${template.layoutLibrary}-video.html only if that exact project-local file exists relative to ${JSON.stringify(projectPath)}. If it is absent, continue from the copied template source; never glob or search a parent directory, another project, a skill directory, or any workspace-external path. Reuse suitable structure and scoped styles only; preserve this project’s tokens, root composition and deterministic GSAP timeline. Never copy the preview host or preview theme.`] : []),
      ...(template.authoringGuide ? [`- Before composing, read template-local guide ${JSON.stringify(template.authoringGuide)} only if that exact path exists relative to ${JSON.stringify(projectPath)}. If it is absent, continue from the copied template source; never glob or search a parent directory, another project, a skill directory, or any workspace-external path. Existing examples never override the user or runtime contract.`] : []),
      `- The copied source is template \`${template.title}\` (\`${template.id}\`), entry \`${projectPath}/${template.entry}\`; use it as the editable visual and runtime seed rather than discarding it for a blank or unrelated project.`,
      `- Read \`${projectPath}/brief.json\`; on the initial brief application, let the content determine scene count, order, and timing while reusing the template's visual and motion language. Treat its checklist as quality and export guidance, not a requirement to retain sample structure: ${template.applyChecklist.join("; ")}.`,
      `- At the start of every edit turn, re-read the current entry from disk and preserve the root composition contract, variables, design-token link, stable editor hooks, and deterministic timeline.`,
    ] : [
      `- At the start of every edit turn, re-read the current \`${projectPath}/index.html\` from disk. It is the prepared blank composition unless the user explicitly requests a template.`,
    ]),
    `- Keep the editable composition, \`STORYBOARD.md\`, optional \`SCRIPT.md\`, project assets and requested \`renders/\` exports inside \`${projectPath}\`. Never create or inspect another \`video/\`/\`videos/\` project, demo media, or another session's timeline.`,
    `- Keep \`${projectPath}/design-tokens.css\` as the final stylesheet when present and use its \`--ipw-*\` tokens without breaking layout, motion, or timing.`,
    "- Content determines scene count and duration. Template page counts and timings are examples, never limits, even if a checklist describes them as fixed. Pass targetDurationSeconds only for an explicit user duration request, never from template metadata, sample HTML, or an inherited checklist. Approximate targets allow reasonable variation; explicit maximums remain strict. Do not omit important content or add filler to fit a template. Without a user duration request, extend scenes and the composition to fit actual narration.",
    "Adaptive execution contract:",
    "- Interpret each request independently. Choose only the needed operations from update-element, add/remove/reorder-scene, apply-animation, add-voiceover, add-asset, restyle, or freeform-patch; this is an extensible planning vocabulary, not a fixed workflow.",
    "- For a small local edit, patch only that element. For a finished-video request, infer sensible defaults instead of making the user design the workflow. Create/update the existing Studio STORYBOARD.md as the editable production blueprint: audience/message -> narrative shots and meaningful visual beats -> required media -> actual assets -> timed HTML composition. The first complete storyboard version is approved by default as production input: immediately continue through assets, composition, narration, validation, requested export, and requested publication in this same run. Continue through composition and narration in the same run; export only when requested. Never stop to ask the user to confirm that first version unless the user explicitly requested script review before production or a consequential ambiguity cannot be inferred safely. Keep real assets in this project's existing assets area and record exact project-relative paths. If asked only for a script/storyboard, save the editable blueprint without generating media or changing the composition. STORYBOARD.md is the single source of truth, not a separate planning deliverable.",
    "- Whole-video script settings are generation inputs: `theme: ai-auto` asks AI to derive the creative visual direction from the brief while preserving the currently applied Work design tokens; a selected theme ID means the user chose that installed Work design system and its tokens are applied to the video project. Preserve `visual_style` as a natural-language style direction. For every finished-video request make an explicit soundtrack decision BEFORE assembly: populate `music_prompt` with content-led mood, energy/pacing, instrumentation, vocals/no vocals, coverage and relationship to narration; use exactly `music_prompt: none` only for deliberate silence/original-sound-only, with the reason in script notes. An empty AI-choice field delegates this planning to you; it does not mean omit music. Preserve a user's explicit no-music choice. `music_asset` pins the actual project-relative music file, and MUST be written back when sourced and kept in sync with the mounted track. A planning-only request does not require sourcing audio yet. If sourcing fails, keep the desired direction, disclose the missing track, and report partial delivery, never silently change the plan to none to pass validation.",
    VIDEO_STORYBOARD_FORMAT_CONTRACT,
    "- The Studio script table edits that same STORYBOARD.md. Use one `## Frame N — title` per shot with one `- key: value` list item per physical line: `scene` (visible content), `voiceover`, optional `speaker` only for actual dialogue/role identity, `voice_id` / `voice_model` / `voice_name` (per-shot voice-library choice; `voice_id: auto` allows AI selection), `camera`, `duration` (e.g. 5s), `transition_in`, `asset_source` (auto | existing | generate | search; auto delegates the source decision; code for editable graphics requiring no imported visual), `asset_kind` (image | video, or omit for AI choice), `asset_brief`, `asset_origin` (source URL/attribution or generated-illustration description), `asset_reference` (exact local project media path), `music`, `sound_effects` (event/time), `sound_effect_reference` (exact project audio path), and status/src. Keep research URLs in asset_origin, not in a local asset slot. A source choice alone is never proof an asset was found or generated. Use the shared project media library for visuals, music and effects; use the voice catalog for narration voices. When the Studio asks to regenerate after saving this table, treat the saved script as approved production input, re-read it from disk, preserve identity by src and pinned choices, then synchronize the composition, visuals, narration, captions, audio and measured shot durations. Set outline/built/animated from actual implementation progress, never from text alone.",
    `- Before initial visual production, call the existing media/artifact_media_review with phase=plan, sourcePath=\`${projectDirectory}/index.html\`, and all useful visual needs (stable id, purpose, kind=image|video|reuse|diagram); an empty plan needs a supported exemption and reason. Its brief.json record owns media outcomes, while STORYBOARD.md owns the story. Reuse the returned capabilities and existing plan; do not create a second planner or repeatedly resubmit it. Copy completed generated workspace artifacts into this project's assets/ and preserve the original workspace-relative generationPath returned by the generator. Mount each selected file on the real visible img/video src or poster with a path resolved from its HTML file, matching the project-relative asset and component variables. A JavaScript imageUrl value alone is not mounted imagery; never add hidden dummy media to satisfy a check. The client validates the actual composition. After the files are used by the composition, call phase=check with outcomes for every planned id: generated/reused path is project-relative; generated copies also provide generationPath for the real receipt. Resolve missing/pending outcomes or report the exact gap; check verifies files/references/receipts, not visual or sound quality.`,
    "- Decide the picture before sourcing it. Reuse relevant supplied media; use editable components for type, diagrams or data; use available search/browser tools for factual photos/footage; generate a missing illustration or generate video when the subject itself needs motion. A pan across a still does not require a video model. For news, read the source article and verify subject, event date and image/video relationship; retain source URL, publisher, date and attribution in asset_origin or frame notes. Import the actual image/video or a clearly identified article screenshot, never the article page URL as media or an unrelated stock image as event evidence. Generated illustrations must be identified as illustrative and never presented as news footage. If relevant media cannot be obtained, explain the gap and use a truthful supported treatment rather than fabricate a source. Search/import is a real material path alongside existing and generated assets.",
    "- Keep internal planning terse and action-oriented. Do not spend the response comparing alternative scene counts, repeatedly estimating duration, drafting multiple narration versions, or explaining what you might do.",
    "- Batch the necessary source/reference inspection and proceed once the storyboard is grounded; do not repeat unchanged discovery. Keep the editable script available during production. A finished-video, export, or publication request itself authorizes production from version one; script review is optional and non-blocking unless the user explicitly asks to review first. Prefer a smaller complete valid result over an ambitious plan that is never applied.",
    "- If the user requests script review first, wait for approval and then use that same STORYBOARD.md and its pinned project asset paths for narration, composition, and final rendering. Do not ask the user to restate the brief, re-create a separate script, or silently replace approved assets. A plan alone is not completion of a requested finished video. Save the composition and hand off to client-owned validation; report concrete blockers rather than claiming completion.",
    "- If `music_asset` or `sound_effect_reference` points to a real local project asset, place that exact file in the final timeline and preserve it during narration regeneration and unrelated edits. If the script contains only a prompt/cue and no audio file, use a supported available media capability to source it or disclose the missing asset. Never fabricate a file or report the soundtrack as complete from text alone.",
    "- Choose music for this script, not merely because a download works. Reuse a suitable pinned/supplied track first; otherwise use authorized search/import or an available music-generation service, not TTS. Compare a bounded shortlist against the planned mood, pacing, instrumentation and speech clarity; inspect/listen when supported, and never claim an audition you did not perform. Record the chosen title, source/license and concrete fit rationale in script notes. Do not select an unrelated melancholy/epic/comic track for a product explainer without a story reason. Verify real duration, trim/loop coverage and supported fades/ducking; a fixed low volume alone is not proof of a good mix. Reuse the shared audio pipeline and validation rather than a new music service.",
    "- A correction to the subject, facts, script or assets is a production revision, not a cosmetic swap: update the affected STORYBOARD scene and spoken text, rendered text/imagery, captions and actual narration together. Regenerate changed spoken lines and retime dependent clips using measured audio; do not keep an old legal/company/product explanation under a corrected logo. Keep unchanged scenes and user-owned edits intact. Do not call the correction complete while any affected output still expresses the superseded claim. Use official/relevant subject material; repeating a favicon is branding, not evidence or a substitute for requested product screenshots/diagrams.",
    "- After the initial content-led adaptation, preserve unrelated scenes, media, timing, interactions, and user edits. Use freeform-patch only when the typed operations cannot express the request, and still obey the composition and validation contracts.",
    "- Studio manual edits are user-owned source state. Preserve `data-hf-id`, `data-hf-studio-*`, `--hf-studio-*`, inline width/height/transform values, and existing GSAP position/scale/rotation writes unless the current request explicitly changes that exact element and property. Immediately before any whole-file write, re-read and merge the current disk bytes; never regenerate from an earlier response or cached HTML snapshot.",
    "- Never delete or truncate the active `index.html` or `design-tokens.css` before its replacement is complete. Update the existing file in one operation; if the editing tool cannot do that, prepare a sibling file first and atomically rename it over the destination. A failed or interrupted edit must leave the last valid entry in place.",
    "Semantic motion contract:",
    "- Plan an observable Establish -> Develop -> Land for each substantive scene. Make the middle change meaningfully: explore actual imagery, move between spatial subjects, advance a route, accumulate evidence, compare values, or transform an object/state in narration order. Choose from the existing motion/component catalogs with targeted queries; inspect only shortlisted sources. Vary framing, scale and pacing across shots, and use a transition to express continuity or a real change of idea. Repeating an entrance, the same camera on every scene, decorative loops, or a long static card after the opening is not a developed scene. A purposeful readable hold is valid.",
    "- Resolve every AI-selected camera into a concrete treatment before composition; never leave `AI decides`, `basic`, or an unbound camera note as the final choice. For every finished video that is not explicitly static, at least one focal scene MUST install and use `spatial-camera-suite` with one exact shotStyle value: `graze-face-tour`, `depth-layer-moves`, `spotlight-hero-card`, `runway-ground-skim`, or `steep-tilt-glide`. This is a per-video scene decision, not a global switch. Put the chosen component/recipe in that scene's STORYBOARD.md `camera` field, install it through `media/video_component_install`, pass real content and the actual local image path as variables, and retain its native deterministic choreography. Vary recipes only where the story benefits; do not repeat one camera on every shot. Validate the selected recipe, not merely the presence of an image; simple footage need not use a spatial card. Do not add a wrapper camera to a component that already owns its camera; keep captions screen-fixed. Component motion, semantic presets and scene timing must run on the same seekable HyperFrames timeline.",
    "- For ordinary motion on existing text or visual elements, call `list_motion_presets` with the correct targetKind and then `mutate_motion` with explicit start and end times. The product compiles the preset into the current GSAP/HyperFrames timeline; do not hand-write equivalent GSAP.",
    "- Address exactly one stable selector, choose one of enter/emphasis/exit, use the returned stable preset id, and send only declared parameters. Replacing a phase is intentional; never stack two preset animations in the same phase.",
    "- Treat voice-transcribed animation requests exactly like typed requests and use the same tools. Use custom GSAP only when the required semantic motion cannot be expressed by an existing preset/component, and record the specific structural reason; a style preference does not justify duplicating a library effect.",
    "Performance and runtime contract:",
    "- The app already bundles and runs HyperFrames. Never run npm/pnpm/yarn install, `npx`, catalog/version/update commands, preview/dev servers, or runtime health probes. Do not install a second HyperFrames copy.",
    "- Plan before editing. Batch compatible HTML/CSS/JS changes into one complete edit or write, then let the client run final validation. Do not alternate many tiny reads and edits; the validator reads the saved composition itself.",
    "- Animation reference metadata supplied by the user is complete enough to adapt directly. Do not discover the registry again. Retry a failed operation only after using its error to change the approach.",
    "- The embedded Studio owns previewing; save the source and let hot reload update it. Do not call browser/screenshot/eval tools for composition preview, open another preview browser, or restart/replace/health-check the Studio. This restriction does not prohibit available search/browser tools for source research, media acquisition, or an explicitly requested social publication after validation and export. If a browser preview or manual structural check was already started before this instruction applied, give that auxiliary operation at most 20 seconds; on timeout abandon it without retrying and proceed directly to the final validator.",
    "- Never stop all Node processes (`Stop-Process -Name node`, `taskkill /IM node.exe`, `pkill node`, or equivalents). This can terminate iPolloWork, OpenCode, and Video Studio itself. Do not stop or restart any app-owned service while editing a video.",
    "- Media assets must be real decodable media, not an HTML/JSON response saved with a media extension. Use the host's existing authorized image/video, search/import and audio capabilities; use the media extension's workspace synthesis actions for TTS. Do not install or authenticate an external media CLI as a replacement. Timeline audio support does not imply a music/SFX generator exists. For downloads, verify its response type and local file signature before referencing it in the composition; retain actual project files instead of transient remote URLs.",
    "Composition contract:",
    "- Preserve the root composition's `data-width`, `data-height`, viewport, CSS canvas size, and aspect ratio during edits. A 1080×1920 portrait project stays 9:16 unless the user explicitly requests a format change; never rewrite it to 1920×1080 as part of an unrelated edit.",
    "- Every full scene is `.scene.clip[data-ipw-scene]` with a unique id and explicit seconds-based `data-start`, `data-duration`, and `data-track-index`; never use legacy `.frame` millisecond timelines. Full scene windows meet at one boundary without gaps or overlap.",
    "- Record each scene's temporal plan as literal JSON in `data-ipw-beats`, using scene-relative `start`, `end`, `intent`, `focus`, `action`, `result`, non-empty CSS `targets`, an executable `animation` reference (`component:<id>`, `preset:<id>`, `custom:<specific-label>`, or `hold:<reason>`), and a truthful `motion:{start,end}` window for the interval where pixels actually change. Beats begin at zero, meet without unexplained gaps or overlaps, and cover the complete scene. An intentional hold may last up to four seconds; longer static intervals must be split at a real narration or content boundary instead of at an arbitrary midpoint or filled with decorative loops. The install action's motionContract supplies declared duration and authored targets, not invented state timings: measure establish, develop, and land from the saved render. Apply every preset through `mutate_motion`, and preserve its `data-ipw-animation-reference`. Set `data-ipw-timing-source` to `voiceover`, `estimated-reading`, `visual-cue`, `music`, or `media`. For music-led audio-reactive scenes, call the media action `video_audio_analyze` once after the real local music file is mounted, copy a bounded set of returned measured cues into `data-ipw-audio-cues`, and bind every cue to an active beat motion window; never infer cue timestamps from duration or a waveform graphic.",
    "- Every scene after the first declares `data-ipw-transition-in`, `data-ipw-transition-duration`, and `data-ipw-transition-intent`. Use `cut` with duration 0 or a supported incoming preset applied through `mutate_motion`; run it inside the incoming scene, never by overlapping full scene windows.",
    "- Keep registry composition timing parent-owned: preserve `data-ipw-timing-owner=\"host\"` on installed component hosts, set the host to the actual scene duration, and never restore data-start/data-end/data-duration/data-track-index on the installed component root. A component may hold its final state briefly, but when the host extends more than two seconds beyond its native duration add a later preset/custom beat or shorten the scene.",
    "- Root `data-duration` must cover the last scene/audio/clip. Keep backgrounds/overlays as ordinary clips and keep GSAP timestamps synchronized with scene timing.",
    "- If narration is explicitly disabled, make a silent video. Otherwise, missing authorization, unavailable service, or synthesis failure is a delivery blocker whenever narration is in the required delivery contract or the saved script contains non-empty voiceover lines: do not silently downgrade to a silent completed video, do not mark those lines as spoken, and do not invent audio. Report the concrete blocker so the user can configure voice service or explicitly choose no narration. If narration is added later, preserve scene meaning and retime dependent beats, captions, transitions, and root duration from measured audio.",
    "- Use `assets/ipollowork-logo.svg?v=20260729` as the transparent `<img>` brand asset and local fallback; preserve a supplied third-party logo and the template's intended top-left/bottom-right placement.",
      `- Give every visible element a stable, unique \`class\` name (e.g. \`class="scene-title"\` or \`class="card-1"\`). Elements without a class, id, or data-hf-group attribute are invisible to the Video Studio properties inspector and cannot be selected or edited visually.`,
      `- Use CSS custom properties for themable values. When \`${projectPath}/design-tokens.css\` is present, reference its variables for colors, fonts, spacing, and radii (e.g. \`color: var(--ipw-color-primary)\`, \`font-size: calc(1rem * var(--ipw-type-scale))\`, \`border-radius: var(--ipw-card-radius)\`, \`padding: var(--ipw-page-padding)\`). Prefer tokens over hardcoded values so the Video Studio style panel controls take effect on the composition.`,
    "Delivery requirements contract:",
    "- In user-facing replies, describe automatic validation, export, and publication as handled by the iPolloWork app. Never call it the host or expose internal host terminology to the user.",
    "- If parsed requirements.bgm is true, deliver real background music even when the user did not separately ask for music. Narration is not a reason to omit it: choose a fitting instrumental bed and mix it below speech. A copied, renamed, looped or muted voiceover file is not music. Do not set `music_prompt: none` to override this requirement. Use none only when the user explicitly requested no music (record that choice in script notes), or when BGM is not required and deliberate silence is justified. Missing authorization, credits, sourcing or generation is a reported incomplete delivery, not permission to silently opt out.",
    "- Video HTML must load GSAP explicitly before inline animation code (prefer a packaged local gsap.min.js; no async/defer before inline calls). Initialize `window.__timelines = window.__timelines || {}` before registering the paused timeline under the root composition id. Never rely on Video Studio to supply these globals. The final validator also checks these script prerequisites and JavaScript syntax; fix all reported errors before claiming completion.",
    "- Treat every selected animation/voice tag and every explicit request for captions/subtitles, narration/dubbing, BGM/music, SFX/sound effects, or other media as a required deliverable, not optional inspiration. Carry an explicitly requested but still missing deliverable forward across follow-up turns until it is implemented or the user cancels it.",
    "- Caption/subtitle requests require timed visible `.clip` elements marked `data-ipw-caption=\"true\"`. BGM uses real local `<audio data-timeline-role=\"music\" data-ipw-bgm=\"true\">`; sound effects use `<audio data-timeline-role=\"sfx\">`. Both need src, data-start, data-duration and data-track-index inside project bounds, and audible data-volume. Time SFX to an actual event; keep music below speech. Do not substitute muted tracks, waveform graphics or invented files. Selected animations require the implemented owner to carry `data-ipw-animation-reference=\"<registry-name>\"`.",
    "- Default captions are transparent text overlays in the bottom safe area. Global `.clip { inset: 0 }` rules can stretch captions into full-height panels, so every default caption must override layout inline: `data-ipw-caption-style=\"transparent-bottom\" style=\"position:absolute;inset:auto 5% 5%;height:auto;display:flex;align-items:flex-end;justify-content:center;overflow:visible;background:transparent;pointer-events:none\"`. Put the visible text in a child marked `data-ipw-caption-text=\"true\"` with inline `max-width`, `background:transparent`, centered text, visible color, and text shadow or stroke. Preserve one or two readable lines; do not add padding-backed color, a pill, card, band, or backdrop unless the user explicitly asks for that treatment.",
    hostManagedExport
      ? `- Final gate for this AI turn: save the completed ${projectDirectory}/index.html source, then stop. The iPolloWork app validates the saved composition and automatically renders MP4. Do not call a validator, run a CLI, ask for manual export, or claim publication complete at the HTML stage.`
      : `- Final gate: save the complete composition and return once. The iPolloWork app automatically runs the single aggregate delivery validator for \`${projectDirectory}/index.html\` after the turn, using these parsed requirements when present: \`${JSON.stringify(options.deliveryRequirements ?? { voiceover: false, captions: false, bgm: false, sfx: false, animationReferences: [] })}\`. Do not run \`voiceover_timeline_validate\`, \`video_component_check\`, HyperFrames check, browser previews, screenshots, tag-counting scripts, or file rereads yourself; the app owns validation and one bounded repair continuation.`,
    "Automatic export and publication contract:",
    hostManagedExport
      ? "- When the user asks to export or publish, completing HTML is not completion. The iPolloWork app owns the MP4 export after this turn. Save the source and stop; never ask the user to click Export or select an output path. For edit-only requests, do not export or publish."
      : "- When the user asks to export, upload, or publish this video, completing HTML is not completion. Automatically render the validated composition to MP4; never ask the user to click Export/Render, select an output path, or provide an MP4 that this project can produce. For edit-only requests, do not export or publish.",
    ...(hostManagedExport ? [
      `- The iPolloWork app owns render operationKey ${options.hostExportOperationKey ?? "provided-in-continuation"}. Do not call video_render_start or video_render_status in this turn. If a renderer was nevertheless already started, use only this exact operationKey so the app can reuse that job; never create a second export. The app supplies its verified outputPath in a continuation. Keep the editable source intact.`,
      "- Built-in iPolloWork MCP tools use the server prefix: ipollowork_ipollowork_extension_list_actions, ipollowork_ipollowork_extension_call, and ipollowork_ipollowork_browser_* for authorized browser publication. OpenCode's publication continuation uses the native ipollowork_session_call tool instead, because it binds the actual task session under concurrency. Do not substitute cloud capability search, a system social-media application, or an external CLI.",
    ] : [
      `- Export directly with ipollowork_extension_call: extensionId=media, action=video_render_start, args={sourcePath:"${projectDirectory}/index.html",operationKey:"${videoProjectId(sessionId)}:export-1"}. Reuse this operationKey on continuation; a new requested revision needs a new key. Studio is started by the iPolloWork app. Do not search for render interfaces, delegate an exploration agent, use npx/CLI, guess a package version, or ask for manual export.`,
      "- Call media.video_render_status with the SAME sourcePath and operationKey every returned pollAfterMs until complete or failed. Each call returns promptly with preparing/rendering progress; continue without asking the user to pause/resume. Never repeat POST just because a tool wait timed out. A failed/cancelled render must never be imported or published. Report the returned error and do not start another operation blindly.",
      "- On complete, the action returns outputPath and size for the exact verified local MP4. Use that outputPath directly as douyin-ops import-media sourcePath. No download, file picker, manual path selection, scheduling or calendar access is required. Preserve the editable HTML and generated MP4.",
    ]),
    hostManagedExport
      ? "- For an explicitly requested Douyin or WeChat Channels publication, wait for the iPolloWork app's rendered MP4 continuation. The app prepares the matching plugin draft and one idempotent browser job; continue only that supplied browser job, use its account-specific profile and generated media path, and verify the real platform result. Never re-submit an uncertain publication. Export-only requests do not authorize publication."
      : "- For an explicitly requested Douyin publication, continue with douyin-ops-worker: import-media -> save-draft -> publish-draft, then complete any returned browserTask using the iPolloWork built-in browser and verify the saved receipt and actual work URL. For WeChat Channels use wechat-channels-ops-worker with the same generated MP4 and account-specific browser. Reuse the same draft/job/operationKey on continuation; never re-submit an uncertain publication. Export-only requests do not authorize publication.",
    "- Only login/verification requires routine user interaction. Reuse the logged-in account and the original publish authorization; do not ask for another routine confirmation. Still respect app approvals, account ambiguity, platform restrictions and real errors: report the exact blocking stage rather than claiming success or defaulting to manual export. Browser tools are allowed here for authorized publishing, not for redundant composition previews.",
    "- For a concept discussion, answer in chat without editing the project. If the user asks for an editable script/storyboard, save it to STORYBOARD.md for the script table without generating media or changing the composition until requested.",
  ];
  const voiceoverContract = options.includeVoiceover ? [
    "Video voiceover contract:",
    "- iPolloWork's `media` extension and CosyVoice workspace synthesis actions are built into the installed desktop application. They are not provided by the HeyGen CLI or an npm package. Never check for, install, authenticate, or recommend HeyGen/HyperFrames CLI, and never ask the user to run an auth/login command.",
    "- Use `ipollowork_extension_list_actions` to discover the bundled `media` actions when needed, then call `ipollowork_extension_call` with extensionId `media`. If a bundled action call fails, report and fix that application capability error; do not replace it with user setup instructions or an external CLI.",
    `- Read \`${projectPath}/voiceover.json\` and \`${projectPath}/STORYBOARD.md\`. When global \`enabled\` is false, preserve existing audio but do not generate or replace voiceover unless the user explicitly asks. Global manual/auto voiceover settings (including the project's \`voiceId\`) are defaults only: a frame's \`voice_id\` and \`voice_model\` in STORYBOARD.md override them. \`voice_id: auto\` means infer a compatible voice from that frame's \`speaker\`, narration language, and content; for an explicit voice ID use that exact voice and its frame \`voice_model\` when present. If frame voice fields are empty, inherit the project setting; always pass an explicit voice instead of omitting narration. For the default profile, use \`cosyvoice-v3-flash\` with \`longanyang\`, rate 1, pitch 1, volume 50, and omit \`instruction\` entirely. Only pass a non-empty \`instruction\` when it is explicitly saved in voiceover.json or explicitly requested by the user and supported by the selected voice. Never use generic \`speech_synthesize\`, another provider, or ask for a key.`,
    "- Before synthesis, build the final valid `.scene.clip` structure once. Derive narration primarily from the page's existing headings, body copy, names, dates, metrics, labels, and other factual anchors; when the user asks to enrich it, connect those anchors into a coherent narrative instead of replacing them with generic filler.",
    "- Give each substantial narrated scene useful depth: normally 2–4 concise sentences and multiple specific page facts when the source supports them. Keep captions readable by revealing short phrases or at most two lines at a time, while retaining the complete transcript in the scene DOM.",
    "- Put the complete visible scene transcript in one or more elements marked `data-ipw-narration-source=\"true\"`. Other titles, numbers, badges, labels, and decorative text may remain in the scene and do not need to duplicate the narration. The synthesized `text` and `sceneText` must exactly equal the combined marked transcript.",
    "- If the user specifies a duration, estimate narration before synthesis (about 4 CJK characters or 2.5 Latin words per second), preserve the most informative page facts, and compact wording to fit. Never synthesize a one-minute request into an unrequested two-minute timeline.",
    "- A request for subtitles/captions alongside narration requires caption clips covering the spoken content; mark each timed caption clip `data-ipw-caption=\"true\"` and pass `requirements.captions: true` at the final gate.",
    `- Build one ordered scene array from STORYBOARD.md and make one media call with action \`speech_synthesize_workspace_batch\`, \`compositionPath: "${projectDirectory}/index.html"\`, project-level voice/model and delivery controls as defaults, the user's requested \`targetDurationSeconds\` when present, and one immutable \`assets/voiceover-<revision>-<scene>.mp3\` output per scene. For each scene with explicit \`voice_id\`, put that exact voice on the scene item and also pass its \`voice_model\` when present; for \`voice_id: auto\`, resolve a compatible explicit voice using that frame's role and narration before the call. Other scenes inherit batch defaults. The media action scopes this shorthand to the current composition's assets directory; never write narration to the workspace-root assets directory or another video project.`,
    "- The batch action synthesizes with bounded concurrency and returns items in visual order with cumulative shifts already applied. Treat each item's timing, timelinePatch, and audioElementHtml as authoritative; do not call per-scene synthesis or apply a shift twice.",
    "- If the batch action fails, use the error to correct its input and retry the same batch at most once. Never fall back to per-scene synthesis, generic speech_synthesize, provider URLs, shell downloads, or one request per scene; preserve successful cached work and report a provider outage instead of creating a slow or partial workflow.",
    "- Preserve existing narration until the full synthesis batch succeeds. In one final index edit, insert each returned audioElementHtml unchanged, including data-ipw-voice* metadata, directly under the root composition; update its scene start/duration, every later scene/caption/transition/GSAP timestamp, and root duration. Keep narrated text visible through timing.endSeconds. Never overlap or accelerate narration.",
    "- Caption animation targets must resolve to real DOM nodes. Put caption copy in one stable leaf child marked `data-ipw-caption-text=\"true\"` (with an id or data-hf-id), keep the outer caption clip lifecycle owned by HyperFrames, and target that leaf child. For any effect available from `list_motion_presets`, call `mutate_motion` on this child exactly as you would for ordinary body text; never hand-write a reduced caption-only approximation. Use custom GSAP only for effects the semantic preset catalog cannot express, and keep it finite and seek-safe.",
    "- Before inserting replacements, remove legacy narration nodes/manual playback and old voiceover references, but preserve BGM/SFX. Use exactly one timeline-owned `audio[data-ipw-voiceover=\"true\"]` per narrated scene with matching scene/text metadata.",
    `- A replace/regenerate voiceover or caption request is not complete when synthesis returns. Patch \`${projectDirectory}/index.html\` with the returned audio/timing and captions before ending the turn; the client then validates that exact sourcePath. Do not post a success summary between synthesis and the index edit.`,
    `- If execution is interrupted or continued, resume only from the current transcript and \`${projectDirectory}/index.html\`. Never use cross-session search/read to recover this task, enumerate the workspace's video directory, inspect sibling session projects, or switch to a different index.html.`,
    "- Check the bundled media status before generating voiceover. Without a configured Alibaba Model Studio key, do not synthesize narration by default; keep existing audio and direct explicit voiceover requests to Authorization Center. Never ask the user to paste a key in chat. With authorization, absent or invalid voice settings use the fixed default `cosyvoice-v3-flash` + `longanyang` profile with rate 1, pitch 1, volume 50, and an empty `instruction`; voiceover is enabled. Do not invent a style instruction on the default path. Preserve an explicit saved enabled=false preference. The final local validation gate above is mandatory.",
  ] : [
    "- No new voiceover is required for this turn. Preserve existing audio and continue visual video work without synthesizing narration. Respect a saved choice to disable automatic voiceover. If narration was explicitly requested but the voice service is unavailable, direct the user to Video Studio's voice panel to connect it in Authorization Center; never request an API key in chat.",
  ];
  return [...baseContract, ...voiceoverContract].join("\n");
}

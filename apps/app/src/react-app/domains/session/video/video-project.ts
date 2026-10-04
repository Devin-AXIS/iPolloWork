import type { TemplateManifestV1 } from "@ipollowork/types/templates";
import type { VideoDeliveryRequirements } from "@ipollowork/types/hyperframes-project";
import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
export type { VideoDeliveryRequirements } from "@ipollowork/types/hyperframes-project";
import {
  hyperframesStudioUrl,
  hyperframesStudioPort,
  videoProjectDirectory,
  videoProjectId,
  videoProjectEntryPath,
} from "@ipollowork/video-studio/project";
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

export async function readVideoBriefDetails(client: iPolloWorkServerClient, workspaceId: string, entryPath: string) {
  const sessionId = videoProjectSessionIdFromEntryPath(entryPath);
  if (!sessionId) return undefined;
  const file = await client.readWorkspaceFile(workspaceId, `${videoProjectDirectory(sessionId)}/brief.json`).catch(() => null);
  if (!file) return undefined;
  try {
    const brief: unknown = JSON.parse(file.content);
    return typeof brief === "object" && brief !== null && "details" in brief && typeof brief.details === "string"
      ? brief.details
      : undefined;
  } catch {
    return undefined;
  }
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

const VOICEOVER_DISABLED_PATTERN = /(?:不要|不用|无需|不需要|关闭|禁用|去掉|取消)\s*(?:旁白|配音|解说|口播|语音合成|tts)|(?:no|without|disable|mute)\s+(?:voice[ -]?over|narration|tts)/i;
// A single negative can govern a media list: "不要旁白、字幕、音乐和音效".
// A new affirmative verb ends that scope: "不要音乐，保留音效".
const DISABLED_VIDEO_MEDIA_PREFIX = new RegExp(
  "(?:不要|不用|不需要|无需|无|無|关闭|禁用|去掉|取消|不加|移除|删除|\\bno|\\bwithout|\\bdisable|\\bremove|\\bmute|\\bdo not add|\\bdon['’]t add)\\s*(?:任何|所有|添加|加入|加|any)?\\s*"
  + "(?:(?:旁白|配音|解说|口播|语音合成|字幕|背景音乐|背景音樂|配乐|配樂|音乐|音樂|音效|voice[ -]?over|narration|tts|caption(?:s|ing)?|subtitles?|bgm|sfx|background music|music bed|music|soundtrack|sound[ -]?effects?)\\s*(?:[,，、/]|和|与|及|或|以及|\\band\\b|\\bor\\b)?\\s*)*$",
  "i",
);
const VIDEO_PRESERVED_CONTENT_PATTERN = /(?:保留|保持|不改|不修改|不要改|不动|不用改|无需改|不重做|不重写|不要重做|不用重做|无需重做)\s*(?:现有|已有|原有|原始|当前|原)?的?\s*(?:脚本|分镜|故事板|旁白|配音)(?:\s*(?:[\/、]|和|与|及)\s*(?:现有|已有|原有|原始|当前|原)?的?\s*(?:脚本|分镜|故事板|旁白|配音))*(?:\s*不变)?|(?:keep|preserve|retain|leave|(?:do not|don['’]t)\s+(?:change|edit|regenerate|redo|rewrite))\s+(?:the\s+)?(?:(?:existing|current|original)\s+)?(?:script|storyboard|voice[ -]?over|narration)(?:\s*(?:\/|\band\b|\bor\b)\s*(?:the\s+)?(?:(?:existing|current|original)\s+)?(?:script|storyboard|voice[ -]?over|narration))*(?:\s+unchanged)?/gi;
const NEGATED_VIDEO_PLANNING_PATTERN = /(?:不要|不用|无需|不需要)\s*(?:只|仅|暂时只)\s*(?:给我)?\s*(?:规划|计划)|\b(?:do\s+not|don['’]t|not|never)\s+(?:only|just)\s+(?:plan|planning)\b/gi;

export function videoPromptRequestsVoiceoverContext(
  capabilityId?: string,
  promptText?: string,
  requirements?: Pick<VideoDeliveryRequirements, "voiceover" | "captions">,
) {
  if (videoPromptRequiresStoryboardReview({ promptText })) return false;
  if (requirements?.captions) return true;
  const text = promptText ?? "";
  if (VOICEOVER_DISABLED_PATTERN.test(text)) return false;
  let preservesNarration = false;
  const narrationText = text.replace(VIDEO_PRESERVED_CONTENT_PATTERN, (preserved) => {
    if (/(?:旁白|配音|voice[ -]?over|narration)/i.test(preserved)) preservesNarration = true;
    return "";
  });
  return (capabilityId === "video-voice-reference" && !preservesNarration)
    || /(?:配音|旁白|解说|语音合成|口播|voice[ -]?over|narrat(?:e|ion)|dub(?:bing)?|text[ -]?to[ -]?speech|\btts\b)/i.test(narrationText)
    || (requirements?.voiceover === true && !preservesNarration && (
      capabilityId === "video-storyboard-regeneration" || videoPromptRequestsFinishedVideo(promptText ?? "")
    ));
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
  originalBriefText?: string;
  animationReferences?: readonly string[];
  voiceoverEnabled?: boolean;
  voiceoverAvailable?: boolean;
}): VideoDeliveryRequirements {
  const text = input.promptText ?? "";
  const originalDuration = requestedVideoDurationSeconds(input.originalBriefText);
  const durationChangeRequested = /(?:改成|改为|调整为|调整到|缩短到|延长到|控制在|设为|变成|现在要).{0,24}(?:\d+(?:\.\d+)?|半|一|二|两|三|四|五|六|七|八|九|十)\s*(?:秒钟?|分钟?|seconds?|minutes?)/iu.test(text);
  const targetDurationSeconds = originalDuration != null && !durationChangeRequested
    ? originalDuration
    : requestedVideoDurationSeconds(text) ?? originalDuration;
  const requestsMedia = (terms: RegExp, defaultRequested = false) => {
    let requested = defaultRequested;
    for (const match of text.matchAll(terms)) {
      const prefix = text.slice(0, match.index);
      requested = !DISABLED_VIDEO_MEDIA_PREFIX.test(prefix);
    }
    return requested;
  };
  const voiceoverExplicitlyDisabled = !requestsMedia(/(?:旁白|配音|解说|口播|语音合成|\btts\b|voice[ -]?over|narration)/gi, true);
  // Default finished-video sound design belongs to the delivery contract, not
  // just the model's prompt. Planning and local edits must not add new tracks.
  const planningOnly = /(?:只|仅|先).{0,12}(?:脚本|分镜|规划)|(?:先别|不要|暂不).{0,8}(?:生成|制作|做)(?:视频|成片)|(?:only|just).{0,16}(?:script|storyboard|plan)|(?:script|storyboard|plan)[ -]only/i.test(text.replace(NEGATED_VIDEO_PLANNING_PATTERN, "").replace(VIDEO_PRESERVED_CONTENT_PATTERN, ""));
  const createsVideo = videoPromptRequestsFinishedVideo(text);
  const requiresRecipesOnly = /(?:禁止|不允许).{0,8}(?:定制|自定义|手绘)图形|(?:必须|全部|只能|仅用|只用).{0,8}(?:真实)?配方|\brecipes[ -]only\b/i.test(text);
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
    captions: requestsMedia(/(?:字幕|caption(?:s|ing)?|subtitles?)/gi),
    bgm: !planningOnly && !silenceRequested && requestsMedia(/(?:背景音乐|背景音樂|配乐|配樂|音乐|音樂|\bbgm\b|background music|music bed|\bmusic\b|soundtrack)/gi, createsVideo),
    sfx: requestsMedia(/(?:音效|\bsfx\b|sound[ -]?effects?)/gi),
    animationReferences: Array.from(new Set((input.animationReferences ?? []).filter(Boolean))),
    ...(requiresRecipesOnly ? { recipesOnly: true } : {}),
    ...(targetDurationSeconds != null ? { targetDurationSeconds } : {}),
  };
}

export function videoPromptRequestsFinishedVideo(promptText: string) {
  if (videoPromptRequiresStoryboardReview({ promptText })) return false;
  return /(?:制作|生成|创作|创建).{0,60}(?:视频|短片|宣传片|广告片)|(?:做)(?!\s*(?:配音|旁白|字幕))[\s\S]{0,60}(?:视频|短片|宣传片|广告片)|\b(?:make|create|produce|generate)\b.{0,80}\b(?:video|film|promo|commercial|explainer)\b/i.test(promptText);
}

export function videoPromptRequiresStoryboardReview(input: {
  promptText?: string;
  hasReferenceAttachments?: boolean;
}) {
  const text = (input.promptText ?? "").replace(NEGATED_VIDEO_PLANNING_PATTERN, "").replace(VIDEO_PRESERVED_CONTENT_PATTERN, "");
  if (/(?:直接|立即|马上|一次性).{0,12}(?:生成|制作|出)(?:成片|视频)|(?:无需|不用|不要|跳过).{0,12}(?:确认|审核|审阅)(?:脚本|分镜)?|\b(?:skip|without)\b.{0,16}\b(?:script|storyboard)\s+(?:review|approval)\b|\bgo straight to (?:production|video)\b/i.test(text)) return false;
  // A detailed storyboard brief can put its explicit production stop well
  // beyond the short "storyboard first" phrase patterns below.
  if (/(?:脚本|分镜|故事板)|\b(?:script|storyboard)\b/i.test(text)
    && /(?:不要|不|暂不|无需)\s*(?:开始|进入|继续|进行)\s*(?:视频|成片|画面)?\s*制作|\b(?:do not|don['’]t|without)\s+(?:start(?:ing)?|begin(?:ning)?|enter(?:ing)?)\s+(?:video\s+)?production\b/i.test(text)) return true;
  return /(?:先|首先|只|仅|暂时只).{0,12}(?:看|写|出|做|给我|审核|审阅|确认).{0,8}(?:脚本|分镜|故事板)|(?:脚本|分镜|故事板).{0,12}(?:先给我看|先确认|确认后再|审核后再|审阅后再|暂不制作|不要生成视频)|\b(?:script|storyboard)\s+(?:first|only|for review)\b|\b(?:review|approve)\s+(?:the\s+)?(?:script|storyboard)\s+(?:first|before production)\b/i.test(text)
    || /(?:只|仅|暂时只)\s*(?:给我)?\s*(?:规划|计划)|\b(?:only|just)\s+(?:plan|planning)\b/i.test(text);
}

export type VideoDeliveryIntent = "export" | "publish-douyin" | "publish-wechat-channels";

const DISABLED_VIDEO_DELIVERY_PREFIX = /(?:不要|不用|不需要|无需|不必|别|取消|暂不|不|\bdo not|\bdon['’]t|\bwithout|\bno need to|\bno)\s*(?:(?:自动|手动|进行|再|mp4|视频文件|导出|输出|渲染|发布|上传|export|render|publish|upload|post)\s*(?:[,，、/]|和|与|及|或|以及|\band\b|\bor\b)?\s*)*$/i;

export function videoDeliveryIntentForPrompt(promptText: string): VideoDeliveryIntent | null {
  const requested = (pattern: RegExp) => [...promptText.matchAll(pattern)]
    .some(match => !DISABLED_VIDEO_DELIVERY_PREFIX.test(promptText.slice(0, match.index)));
  if (requested(/(?:发布|上传|发到|发至|发)[^,，。.!！?？;；\n]{0,12}抖音|抖音[^,，。.!！?？;；\n]{0,12}(?:发布|上传)|(?:publish|upload|post)[^,，。.!！?？;；\n]{0,20}douyin|douyin[^,，。.!！?？;；\n]{0,20}(?:publish|upload|post)/gi)) return "publish-douyin";
  if (requested(/(?:发布|上传|发到|发至|发)[^,，。.!！?？;；\n]{0,12}(?:微信)?视频号|(?:微信)?视频号[^,，。.!！?？;；\n]{0,12}(?:发布|上传)|(?:publish|upload|post)[^,，。.!！?？;；\n]{0,20}wechat channels|wechat channels[^,，。.!！?？;；\n]{0,20}(?:publish|upload|post)/gi)) return "publish-wechat-channels";
  if (/(?:不要|不用|不需要|无需|不必|别|取消|暂不|不)\s*(?:自动|手动|再)?\s*(?:mp4\s*)?(?:导出|渲染)|(?:do not|don['’]t|without|no need to)\s*(?:mp4\s+)?(?:export|render)/i.test(promptText)) return null;
  return requested(/(?:导出|输出|生成)[^,，。.!！?？;；\n]{0,12}(?:mp4|视频文件)|(?:mp4|视频文件)[^,，。.!！?？;；\n]{0,12}(?:导出|输出|生成)|\b(?:export|render)\b[^,，。.!！?？;；\n]{0,20}(?:mp4|video)/gi)
    ? "export"
    : null;
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
  options: { includeVoiceover?: boolean; deliveryRequirements?: VideoDeliveryRequirements; requireStoryboardReview?: boolean } = {},
) {
  const projectDirectory = videoProjectDirectory(sessionId);
  const projectPath = videoProjectPath(sessionId, workspaceRoot);
  return [
    "Video task contract:",
    "Create or edit an editable HyperFrames composition. Read ipollowork-video-studio once; it owns creative planning and routes to only the specialist needed now. Do not preload unrelated stages.",
    `Own only \`${projectPath}\`. Video Studio displays \`${projectPath}/index.html\` at http://localhost:${hyperframesStudioPort(sessionId)} and hot-reloads saves. Keep STORYBOARD.md, optional SCRIPT.md, assets and renders in this project. Never create or inspect another session's project.`,
    `For Video Studio tools that accept sessionId, use exactly "${sessionId}" when the engine does not forward native conversation context.`,
    "Read the current entry before editing and immediately before replacement; merge user edits; preserve root/aspect ratio, hooks, variables, tokens and media. Save a complete replacement atomically. The app owns Studio/services; do not install runtimes, start another preview, stop Node processes. Use the existing media tools to inspect, check and render the current project.",
    ...(template ? [
      `Template seed: ${JSON.stringify({ id: template.id, title: template.title, entry: `${projectPath}/${template.entry}`, applyChecklist: template.applyChecklist })}. Adapt this visual and runtime seed to the user's content; sample scene counts and timings do not constrain the deliverable. Read ${projectPath}/brief.json and the current entry.`,
      ...(template.layoutLibrary || template.authoringGuide ? [
        `Optional template-local guidance: ${JSON.stringify([...(template.layoutLibrary ? [`${template.layoutLibrary}-video/catalog.md`] : []), ...(template.authoringGuide ? [template.authoringGuide] : [])])}. Read only if that exact project-local file exists; otherwise continue from the seed. Never glob or search a parent directory or workspace-external path for missing guidance.`,
      ] : []),
    ] : ["Use the prepared blank composition unless the user explicitly selected a template." ]),
    VIDEO_STORYBOARD_FORMAT_CONTRACT,
    "Keep design-tokens.css and --ipw-* palette/type tokens, static data-composition-variables with stable IDs, and editable nodes/hooks. Components and custom content inherit the active design system; later theme/token changes preserve variables, media and timeline. Do not bake theme values into every scene or flatten editable content into imagery.",
    options.requireStoryboardReview
      ? `Script review requested: load ipollowork-video-storyboard and create or update only \`${projectPath}/STORYBOARD.md\`, then wait for the user's review. Do not source or generate media or change index.html in this turn.`
      : "For a finished-video request, continue from the saved storyboard through production. Pause only when the user explicitly requests script review or script-only work; discussions and targeted edits keep their requested scope.",
    `Delivery requirements: ${JSON.stringify(options.deliveryRequirements ?? { voiceover: false, captions: false, bgm: false, sfx: false, animationReferences: [] })}. These parsed requirements are enforced independently of HTML metadata; preserve them through repairs.`,
    "Use your native plan, tools and subagents to finish the user's request. Check actual files with the existing media tools, repair discovered defects, and return links to the real deliverables. iPolloWork displays your results; it does not continue or repair the task after you stop.",
    `For requested MP4 delivery, call media/video_render_start with sourcePath:"${projectDirectory}/index.html" and a stable operationKey, then video_render_status with the same identifiers until complete or failed. Return the actual outputPath. Reuse completed exports; never start a duplicate after a wait timeout.`,
    "Export-only requests do not authorize publication. Authorized publishing reuses installed iPolloWork tools, worker, supplied account-specific browser job, draft, media path and operationKey; verify the real receipt. Never re-submit an uncertain publication or import a failed/cancelled render. Follow the supplied session-bound tool instructions.",
    ...(options.includeVoiceover && !options.requireStoryboardReview ? [
      `When narration/caption production begins: Read ipollowork-video-voiceover once and the current \`${projectPath}/voiceover.json\` and STORYBOARD.md. For new requested narration or missing narration required by the finished deliverable, use saved scene/project voice settings and built-in speech_synthesize_workspace_batch defaults. Caption-only work reuses existing audio/word timings without resynthesizing; keep assets under \`${projectDirectory}/assets\`. Check media authorization, preserve explicit enabled=false, and finish mounting the returned audio/captions before completion.`,
    ] : [
      "No voiceover Skill preload or new synthesis is needed for the current stage; preserve existing audio. If actual spoken-content edits or a missing-narration repair become necessary later, load ipollowork-video-voiceover at that stage. Unavailable narration uses Video Studio's voice panel and Authorization Center; never request an API key in chat.",
    ]),
  ].join("\n");
}

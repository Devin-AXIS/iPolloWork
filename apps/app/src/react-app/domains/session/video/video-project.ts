import type { TemplateManifestV1 } from "@ipollowork/types/templates";

export const HYPERFRAMES_STUDIO_LABEL = "Local HyperFrames Studio";

const HYPERFRAMES_PORT_BASE = 3_100;
const HYPERFRAMES_PORT_RANGE = 800;

export function hyperframesStudioPort(sessionId: string) {
  let hash = 0;
  for (const character of sessionId) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return HYPERFRAMES_PORT_BASE + (hash % HYPERFRAMES_PORT_RANGE);
}

export function hyperframesStudioUrl(
  port = 3_002,
  projectId = "video",
  locale?: string,
  theme?: "light" | "dark",
  reloadToken?: number,
) {
  // Start on a deterministic, hydrated main-composition frame. HyperFrames can
  // otherwise restore a panel/playhead state before its preview has mounted,
  // which leaves the first playback visually empty until a timeline layer is
  // selected.
  const params = new URLSearchParams({
    v: "1",
    t: "0",
    tab: "design",
    rc: "1",
    tv: "1",
  });
  if (locale) params.set("locale", locale);
  if (theme) params.set("ipolloworkTheme", theme);
  if (reloadToken != null) params.set("reload", String(reloadToken));
  return `http://localhost:${port}/#project/${encodeURIComponent(projectId)}?${params.toString()}`;
}

export function videoProjectId(sessionId: string) {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function videoProjectDirectory(sessionId: string) {
  return `video/${videoProjectId(sessionId)}`;
}

export function videoProjectEntryPath(sessionId: string) {
  return `${videoProjectDirectory(sessionId)}/index.html`;
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
  if (capabilityId === "video-voice-reference") return true;
  return /(?:配音|旁白|解说|语音合成|voice[ -]?over|narrat(?:e|ion)|dub(?:bing)?|text[ -]?to[ -]?speech|\btts\b)/i.test(promptText ?? "");
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
  template?: Pick<TemplateManifestV1, "id" | "title" | "entry" | "applyChecklist"> | null,
  options: { includeVoiceover?: boolean } = {},
) {
  const projectDirectory = videoProjectDirectory(sessionId);
  const projectPath = videoProjectPath(sessionId, workspaceRoot);
  const studioPort = hyperframesStudioPort(sessionId);
  const baseContract = [
    "Video task contract:",
    `- Own only \`${projectPath}\`; Video Studio displays \`${projectPath}/index.html\` at \`http://localhost:${studioPort}\` and hot-reloads saves.`,
    ...(template ? [
      `- The copied source is template \`${template.title}\` (\`${template.id}\`), entry \`${projectPath}/${template.entry}\`; edit it rather than starting over.`,
      `- Read \`${projectPath}/brief.json\` and the entry once, then preserve the composition id, variables, visual system, editable hierarchy, and checklist: ${template.applyChecklist.join("; ")}.`,
    ] : [
      `- Read \`${projectPath}/index.html\` once. It is the prepared blank composition unless the user explicitly requests a template.`,
    ]),
    `- Write only \`${projectPath}/index.html\` and assets below \`${projectPath}\`. Never create or inspect another \`video/\`/\`videos/\` project, demo media, or another session's timeline.`,
    `- Keep \`${projectPath}/design-tokens.css\` as the final stylesheet when present and use its \`--ipw-*\` tokens without breaking layout, motion, or timing.`,
    "Adaptive execution contract:",
    "- Interpret each request independently. Choose only the needed operations from update-element, add/remove/reorder-scene, apply-animation, add-voiceover, add-asset, restyle, or freeform-patch; this is an extensible planning vocabulary, not a fixed workflow.",
    "- For a small local edit, patch only that element. For a structural, multi-scene, or narrated edit, first form one complete internal operation plan from the current composition, then execute it without narrating the plan or creating a plan file.",
    "- Preserve unrelated scenes, media, timing, interactions, and user edits. Use freeform-patch only when the typed operations cannot express the request, and still obey the composition and validation contracts.",
    "Performance and runtime contract:",
    "- The app already bundles and runs HyperFrames. Never run npm/pnpm/yarn install, `npx`, catalog/version/update commands, preview/dev servers, or runtime health probes. Do not install a second HyperFrames copy.",
    "- Plan before editing. Batch compatible HTML/CSS/JS changes into one complete edit or write, then do one final read and one final validation. Do not alternate many tiny reads and edits.",
    "- Animation reference metadata supplied by the user is complete enough to adapt directly. Do not discover the registry again. Retry a failed operation only after using its error to change the approach.",
    "- The embedded Studio owns previewing; save the source and let hot reload update it. Do not open another browser or restart/replace/health-check the Studio.",
    "- Never stop all Node processes (`Stop-Process -Name node`, `taskkill /IM node.exe`, `pkill node`, or equivalents). This can terminate iPolloWork, OpenCode, and Video Studio itself. Do not stop or restart any app-owned service while editing a video.",
    "- Media assets must be real decodable media, not an HTML/JSON response saved with a media extension. Prefer the media extension for BGM/SFX/images/video; if a direct download is unavoidable, verify its response type and local file signature before referencing it in the composition.",
    "Composition contract:",
    "- Every full scene is `.scene.clip` with a unique id and explicit seconds-based `data-start`, `data-duration`, and `data-track-index`; never use legacy `.frame` millisecond timelines or overlapping scene windows.",
    "- Root `data-duration` must cover the last scene/audio/clip. Keep backgrounds/overlays as ordinary clips and keep GSAP timestamps synchronized with scene timing.",
    "- Use `assets/ipollowork-logo.svg?v=20260729` as the transparent `<img>` brand asset and local fallback; preserve a supplied third-party logo and the template's intended top-left/bottom-right placement.",
    `- Final gate: after all edits, call \`ipollowork_extension_call\` once with extensionId \`media\`, action \`voiceover_timeline_validate\`, sourcePath \`${projectDirectory}/index.html\`. It validates local composition, scenes, duration, and narration without provider quota. If invalid, fix all reported issues together and run it once more; never run \`npx hyperframes check\`.`,
    "- If the user only asks for a script, concept, or storyboard, answer in chat and leave the video project unchanged until they ask to make or edit the video.",
  ];
  const voiceoverContract = options.includeVoiceover ? [
    "Video voiceover contract:",
    `- Read \`${projectPath}/voiceover.json\`; its \`voiceId\` and \`model\` are authoritative. Never use generic \`speech_synthesize\`, another provider, or ask for a key.`,
    "- Before synthesis, build the final valid `.scene.clip` structure once. Derive narration primarily from the page's existing headings, body copy, names, dates, metrics, labels, and other factual anchors; when the user asks to enrich it, connect those anchors into a coherent narrative instead of replacing them with generic filler.",
    "- Give each substantial narrated scene useful depth: normally 2–4 concise sentences and multiple specific page facts when the source supports them. Keep captions readable by revealing short phrases or at most two lines at a time, while retaining the complete transcript in the scene DOM.",
    "- Put the complete visible scene transcript in one or more elements marked `data-ipw-narration-source=\"true\"`. Other titles, numbers, badges, labels, and decorative text may remain in the scene and do not need to duplicate the narration. The synthesized `text` and `sceneText` must exactly equal the combined marked transcript.",
    "- If the user specifies a duration, estimate narration before synthesis (about 4 CJK characters or 2.5 Latin words per second), preserve the most informative page facts, and compact wording to fit. Never synthesize a one-minute request into an unrequested two-minute timeline.",
    `- Build one ordered scene array, then make one media call with action \`speech_synthesize_workspace_batch\`, \`compositionPath: "${projectDirectory}/index.html"\`, the selected voice/model, the user's requested \`targetDurationSeconds\` when present, and one immutable \`assets/voiceover-<revision>-<scene>.mp3\` output per scene.`,
    "- The batch action synthesizes with bounded concurrency and returns items in visual order with cumulative shifts already applied. Treat each item's timing, timelinePatch, and audioElementHtml as authoritative; do not call per-scene synthesis or apply a shift twice.",
    "- In one final index edit, insert each returned audioElementHtml directly under the root composition; update its scene start/duration, every later scene/caption/transition/GSAP timestamp, and root duration. Keep narrated text visible through timing.endSeconds. Never overlap or accelerate narration.",
    "- Before inserting replacements, remove legacy narration nodes/manual playback and old voiceover references, but preserve BGM/SFX. Use exactly one timeline-owned `audio[data-ipw-voiceover=\"true\"]` per narrated scene with matching scene/text metadata.",
    "- If voice settings are absent or invalid, continue visually without choosing a random voice. The final local validation gate above is mandatory.",
  ] : [
    "- Narration is opt-in for performance: do not synthesize speech unless the user selected a voice, explicitly requested narration, or the existing composition already contains voiceover nodes.",
  ];
  return [...baseContract, ...voiceoverContract].join("\n");
}

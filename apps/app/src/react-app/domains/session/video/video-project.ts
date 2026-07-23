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
) {
  const projectDirectory = videoProjectDirectory(sessionId);
  const projectPath = videoProjectPath(sessionId, workspaceRoot);
  const studioPort = hyperframesStudioPort(sessionId);
  return [
    "Video task contract:",
    `- This conversation owns the HyperFrames project at \`${projectPath}\`.`,
    `- The right-side Video Studio displays only \`${projectPath}/index.html\` for this conversation.`,
    `- The right-side Video Studio opens after the project brief is confirmed at \`http://localhost:${studioPort}\` and hot-reloads saved changes.`,
    ...(template ? [
      `- This conversation was created from the \`${template.title}\` video template (\`${template.id}\`). It has already been copied into this session; do not start a blank project.`,
      `- Treat \`${projectPath}/${template.entry}\` as the source of truth. Read it before responding to a request to make or edit the video.`,
      `- Read \`${projectPath}/brief.json\` before making or revising the video. It contains the user-confirmed topic, audience, and objective for this template.`,
      `- Preserve the template's composition id, declared variables, visual system, and editable structure unless the user explicitly asks to replace them. Apply the user's request by editing this template, not by generating an unrelated video.`,
      `- Keep the template checklist in scope: ${template.applyChecklist.join("; ")}.`,
    ] : [
      "- This project starts as a blank HyperFrames composition unless the user asks to import or use a video template. The HyperFrames skill is installed automatically when the project is created; use that skill and its CLI when you create or edit the video.",
    ]),
    "- Never add example clips, demo assets, or another session's timeline. Build only the scenes, media, and animations the user asks for.",
    `- Before editing, read \`${projectPath}/index.html\`. This is the exact writable path, not a suggestion: do not derive another path from your current directory and do not choose a custom project name.`,
    `- When asked to create or revise the video, update \`${projectPath}/index.html\` only; keep its root \`index.html\` as the playable main composition and keep any assets inside \`${projectPath}\`.`,
    "- Never create, inspect, render, validate, preview, or report a `videos/` directory, a custom-named HyperFrames project, or another `video/` project. A rendered MP4 or narration outside the exact path above is not this conversation's Video Studio output and never completes the task.",
    "- Do not run `npx hyperframes preview`, `npm run dev`, `open`, or a browser tool for the local Studio. The embedded Studio owns previewing; do not start a second server or open an external browser. Do not restart, replace, or health-check the embedded Studio server; save `index.html` and let it hot-reload.",
    "- Never stop all Node processes (`Stop-Process -Name node`, `taskkill /IM node.exe`, `pkill node`, or equivalents). This can terminate iPolloWork, OpenCode, and Video Studio itself. Do not stop or restart any app-owned service while editing a video.",
    `- Before saying the edit is ready, verify the exact session project by running \`npx hyperframes check\` from \`${projectPath}\` and confirm that its \`index.html\` contains the requested scenes. Do not validate any other directory.`,
    `- Do not create, reuse, open, or modify a different video/ directory or another conversation's project. The session-relative project key is \`${projectDirectory}\`.`,
    "- Every full visual scene must be a `.scene.clip` with explicit seconds-based `data-start`, `data-duration`, and `data-track-index`. Do not use legacy `class=\"frame\"` sections, millisecond `data-duration=\"4000\"` declarations, a JavaScript scene-duration array, or a text-only timeline summary as the source of truth. After every AI edit, recompute scene windows in visual order so one scene ends at or before the next begins; never leave two `.scene` windows overlapping. Backgrounds, persistent canvas layers, captions, and deliberate overlays remain ordinary `.clip` elements and may span scenes.",
    "- The root composition `data-duration` must be the real HyperFrames timeline duration in seconds: at least the last scene/audio/clip end time, never just the number of scenes or a placeholder like 8. If a written plan says 42 seconds, `index.html` must also declare a roughly 42 second root duration and matching scene/audio timeline windows.",
    "- When the video shows the iPolloWork brand, use the project asset `assets/ipollowork-logo.svg?v=20260721`, which contains the current 106 by 106 mark. Never redraw, inline, or regenerate an older iPolloWork logo. Preserve a user-supplied non-iPolloWork brand logo when the brief or template explicitly provides one.",
    "Video voiceover contract:",
    `- Decide whether narration helps the confirmed brief without asking a separate narration question. When it does, read \`${projectPath}/voiceover.json\` first; its \`voiceId\` and \`model\` are the only voice choice for this video task.`,
    "- Never call generic `speech_synthesize` for Video Studio narration. It returns an unbound audio result and cannot prove scene timing. Use only `speech_synthesize_workspace_file` for narrated video scenes.",
    `- When narration is useful and a valid selection exists, call \`ipollowork_extension_list_actions\` for extensionId \`media\`. Split the narration by visual scene, then call \`ipollowork_extension_call\` once per scene with extensionId \`media\`, action \`speech_synthesize_workspace_file\`, the exact \`sceneId\`, \`sceneText\`, \`sceneStart\`, and current \`sceneDuration\`, \`compositionPath: "${projectDirectory}/index.html"\`, the same \`sceneText\` as \`text\`, the selected \`voiceId\` as \`voice\`, the selected \`model\`, and a new immutable MP3 \`outputPath\` such as \`video/<session>/assets/voiceover-<unique-revision>.mp3\`. The action rejects narration text that differs from the visible scene text. Do not use an unrelated TTS provider or ask the user for a key.`,
    "- Build a scene narration table before synthesis. Each row must contain one `.scene` id, that scene's exact start, and its current visible on-screen text in reading order. The synthesized narration must read that same scene's visible text verbatim in the same order; do not paraphrase, summarize, add commentary, narrate a previous or future scene, or let one narration continue into the next scene.",
    "- Voiceover is the master clock. Do not lock the video to the original target duration when narration is present. If the spoken audio is slower than the visuals, lengthen the current scene and slow the visual handoff; never cut away while the current scene's words are still being spoken.",
    "- Treat each action result's actual `durationSeconds`, `timing`, `timelinePatch`, and `audioElementHtml` as authoritative. Process scenes strictly in visual order. Maintain a cumulative shift starting at zero; before synthesizing each later scene, add that cumulative shift to its original start. Set the scene and voiceover to the exact scene start in `timing.startSeconds`, set the scene duration to `timing.requiredSceneDurationSeconds`, then add `timing.shiftFollowingBySeconds` to the cumulative shift for every later scene, narration, caption, transition, and GSAP timestamp. Voiceovers must never overlap. Do not accelerate speech to force long text into a short scene.",
    "- Add `data-ipw-scene-id` with the matching `.scene` id, `data-ipw-scene-text` with the scene's visible text snapshot, and `data-ipw-narration-text` with the exact synthesized text to every voiceover audio node. `data-ipw-scene-text` and `data-ipw-narration-text` must be identical. Before finishing, verify each audio node's `data-start` equals its scene's exact start.",
    "- The matching scene and all text being narrated must remain visibly present for the entire narration window, from `timing.startSeconds` through `timing.endSeconds`. Narrated text must not animate out, hide, or be replaced by the next scene before the voiceover ends; delay its exit animation and the next scene's entrance when necessary.",
    "- Make all text referenced by a narration visible when that narration begins. If the actual narration is longer than the visual scene, extend that same visual scene and shift every later scene, narration start, and transition by the same amount. Add a short reading buffer after speech, then update the root `data-duration` so the complete final narration fits, even when that makes the final video longer than originally planned.",
    "- Keep GSAP timelines synchronized with every shifted scene start and extended scene duration. Do not leave animation timestamps, outro timing, or the root `data-duration` at their old values after narration changes.",
    "- Add one `audio` element per scene narration as a direct child of the root composition by inserting the action result's `audioElementHtml`; do not hand-author a different narration tag unless you preserve every returned synchronization attribute exactly. Every narration element must have `data-ipw-voiceover=\"true\"`, a unique id, the returned immutable source path, and deliberate `data-start`, `data-track-index`, and `data-volume` values. Never create a single `assets/voiceover.mp3`, `voiceover_1.mp3` sequence controlled by one hidden player, a `voiceover.src = ...` swapper, a JavaScript array such as `['assets/vo_01.mp3']`, `new Audio(...)`, or custom frame-change playback. The immutable filename must never overwrite an existing voiceover asset. HyperFrames owns playback: never call `audio.play()`, `pause()`, or seek methods.",
    "- Before adding regenerated narration, remove every old narration node or script reference matching `audio[data-ipw-voiceover=\"true\"]`, `audio[id^=\"vo-\"]`, `audio[id=\"voiceover\"]`, `audio[src*=\"/audio/voice/\"]`, `audio[src*=\"voiceover-\"]`, `audio[src*=\"voiceover_\"]`, `assets/voiceover.mp3`, `assets/voiceover_*.mp3`, `assets/vo_*.mp3`, or manual `new Audio(...)` / `.play()` playback from `index.html`; never remove BGM or sound-effect audio. Only after the updated `index.html` successfully references all new files as HyperFrames timeline audio nodes, delete obsolete voiceover MP3 files that are no longer referenced. There must be exactly one narration audio node per narrated scene and no legacy narration nodes. This prevents stale or duplicate narration while preserving other audio tracks.",
    `- Completion gate: after every video or narration edit, first run \`npx hyperframes check\` from \`${projectPath}\`, then call \`ipollowork_extension_call\` with extensionId \`media\`, action \`voiceover_timeline_validate\`, and sourcePath \`${projectDirectory}/index.html\`. Do not finish the task while \`valid\` is false. If either check fails, fix every reported issue and run both checks again; finish only after both pass on the final saved file.`,
    "- If the selection file is absent or invalid, continue as a visual video without substituting a random voice or blocking the task.",
    "- If the user only asks for a script, concept, or storyboard, answer in chat and leave the video project unchanged until they ask to make or edit the video.",
  ].join("\n");
}

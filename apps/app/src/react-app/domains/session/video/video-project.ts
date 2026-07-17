import type { TemplateManifestV1 } from "@ipollowork/types/templates";

export const HYPERFRAMES_STUDIO_LABEL = "Local HyperFrames Studio";

const HYPERFRAMES_PORT_BASE = 3_100;
const HYPERFRAMES_PORT_RANGE = 800;

export function hyperframesStudioPort(sessionId: string) {
  let hash = 0;
  for (const character of sessionId) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return HYPERFRAMES_PORT_BASE + (hash % HYPERFRAMES_PORT_RANGE);
}

export function hyperframesStudioUrl(port = 3_002, projectId = "video") {
  // Start on a deterministic, hydrated main-composition frame. HyperFrames can
  // otherwise restore a panel/playhead state before its preview has mounted,
  // which leaves the first playback visually empty until a timeline layer is
  // selected.
  return `http://localhost:${port}/#project/${encodeURIComponent(projectId)}?v=1&t=0&tab=design&rc=1&tv=1`;
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
    "- Do not run `npx hyperframes preview`, `npm run dev`, `open`, or a browser tool for the local Studio. The embedded Studio owns previewing; do not start a second server or open an external browser.",
    `- Before saying the edit is ready, verify the exact session project by running \`npx hyperframes check\` from \`${projectPath}\` and confirm that its \`index.html\` contains the requested scenes. Do not validate any other directory.`,
    `- Do not create, reuse, open, or modify a different video/ directory or another conversation's project. The session-relative project key is \`${projectDirectory}\`.`,
    "Video voiceover contract:",
    `- Decide whether narration helps the confirmed brief without asking a separate narration question. When it does, read \`${projectPath}/voiceover.json\` first; its \`voiceId\` and \`model\` are the only voice choice for this video task.`,
    "- When narration is useful and a valid selection exists, call `ipollowork_extension_list_actions` for extensionId `media`, then call `ipollowork_extension_call` with extensionId `media`, action `speech_synthesize`, and the selected `voiceId` / `model` in MP3 format. Do not use an unrelated TTS provider or ask the user for a key.",
    `- The synthesis result contains a short-lived audio URL. Download it immediately to a new immutable file such as \`${projectPath}/assets/voiceover-<unique-revision>.mp3\`; do not leave the temporary provider URL in the project or response. After index.html points to that new file, delete the previous voiceover asset so there is only one current narration file.`,
    "- Add or update exactly one `audio` element for the current `assets/voiceover-<unique-revision>.mp3` in `index.html`. It must be a direct child of the root composition with a unique id and deliberate `data-start`, `data-track-index`, and `data-volume` values. The immutable filename is required: never overwrite an existing voiceover file in place, because an already-open Studio can replay cached old narration. HyperFrames owns playback: never call `audio.play()`, `pause()`, or seek methods.",
    "- Match the narration to the video timing. Adjust the script or scene duration deliberately when the speech does not fit the composition.",
    "- If the selection file is absent or invalid, continue as a visual video without substituting a random voice or blocking the task.",
    "- If the user only asks for a script, concept, or storyboard, answer in chat and leave the video project unchanged until they ask to make or edit the video.",
  ].join("\n");
}

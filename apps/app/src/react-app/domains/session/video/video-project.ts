import type { TemplateManifestV1 } from "@ipollowork/types/templates";

export const HYPERFRAMES_VERSION = "0.7.52";

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

export function hyperframesPreviewCommand(sessionId: string) {
  const projectDirectory = videoProjectDirectory(sessionId);
  const studioPort = hyperframesStudioPort(sessionId);
  // `init` also installs HyperFrames' agent skills the first time it is run.
  // Do not opt out: a video task needs both an empty, session-owned timeline
  // and an agent that understands how to edit that timeline.
  return `if [ ! -f ${projectDirectory}/index.html ]; then npx --yes hyperframes@${HYPERFRAMES_VERSION} init ${projectDirectory} --example blank --non-interactive; fi && cd ${projectDirectory} && npx --yes hyperframes@${HYPERFRAMES_VERSION} preview --port ${studioPort} --no-open\n`;
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
    `- The right-side Video Studio is already running at \`http://localhost:${studioPort}\` and hot-reloads saved changes. It opens automatically for this video task.`,
    ...(template ? [
      `- This conversation was created from the \`${template.title}\` video template (\`${template.id}\`). It has already been copied into this session; do not start a blank project.`,
      `- Treat \`${projectPath}/${template.entry}\` as the source of truth. Read it before responding to a request to make or edit the video.`,
      `- Preserve the template's composition id, declared variables, visual system, and editable structure unless the user explicitly asks to replace them. Apply the user's request by editing this template, not by generating an unrelated video.`,
      `- Keep the template checklist in scope: ${template.applyChecklist.join("; ")}.`,
    ] : [
      "- This project starts as a blank HyperFrames composition unless the user asks to import or use a video template. The HyperFrames skill is installed automatically when the project is created; use that skill and its CLI when you create or edit the video.",
    ]),
    "- Never add example clips, demo assets, or another session's timeline. Build only the scenes, media, and animations the user asks for.",
    `- Before editing, read \`${projectPath}/index.html\`. This is the exact writable path, not a suggestion: do not derive another path from your current directory and do not choose a custom project name.`,
    `- When asked to create or revise the video, update \`${projectPath}/index.html\` only; keep its root \`index.html\` as the playable main composition and keep any assets inside \`${projectPath}\`.`,
    "- Never create a `videos/` directory, a custom-named HyperFrames project, or another `video/` project. Do not write outside the exact path above.",
    "- Do not run `npx hyperframes preview`, `npm run dev`, `open`, or a browser tool for the local Studio. The embedded Studio owns previewing; do not start a second server or open an external browser.",
    "- Validate video changes by inspecting the project files or using non-preview HyperFrames tooling before saying the edit is ready.",
    `- Do not create, reuse, open, or modify a different video/ directory or another conversation's project. The session-relative project key is \`${projectDirectory}\`.`,
    "- If the user only asks for a script, concept, or storyboard, answer in chat and leave the video project unchanged until they ask to make or edit the video.",
  ].join("\n");
}

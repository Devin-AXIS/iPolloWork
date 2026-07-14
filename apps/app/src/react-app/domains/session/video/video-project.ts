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
export function videoTaskSystemContext(sessionId: string) {
  const projectDirectory = videoProjectDirectory(sessionId);
  return [
    "Video task contract:",
    `- This conversation owns the HyperFrames project at \`${projectDirectory}\`.`,
    `- The right-side Video Studio displays only \`${projectDirectory}/index.html\` for this conversation.`,
    "- This is a blank HyperFrames project. The HyperFrames skill is installed automatically when the project is created; use that skill and its CLI when you create or edit the video.",
    "- Never add example clips, demo assets, or another session's timeline. Build only the scenes, media, and animations the user asks for.",
    `- When asked to create or revise the video, inspect and update that project only; keep its root \`index.html\` as the playable main composition and keep any assets inside the same directory.`,
    "- Validate video changes with the HyperFrames tooling before saying the edit is ready.",
    "- Do not create, reuse, open, or modify a different video/ directory or another conversation's project.",
    "- If the user only asks for a script, concept, or storyboard, answer in chat and leave the video project unchanged until they ask to make or edit the video.",
  ].join("\n");
}

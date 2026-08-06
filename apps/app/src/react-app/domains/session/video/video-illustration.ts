const VIDEO_ILLUSTRATION_DISPLAY_PREFIX = "Video illustration display:";

export type VideoIllustrationAiReference = {
  id: "ian-xiaohei-illustrations";
  label: string;
  repository: "helloianneo/ian-xiaohei-illustrations";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseVideoIllustrationReference(value: unknown): VideoIllustrationAiReference | null {
  if (!isRecord(value)) return null;
  if (value.id !== "ian-xiaohei-illustrations") return null;
  if (value.repository !== "helloianneo/ian-xiaohei-illustrations") return null;
  if (typeof value.label !== "string" || !value.label.trim()) return null;
  return { id: value.id, label: value.label.trim(), repository: value.repository };
}

export function videoIllustrationDisplayMetadata(reference: VideoIllustrationAiReference) {
  return `${VIDEO_ILLUSTRATION_DISPLAY_PREFIX}${JSON.stringify(reference)}`;
}

export function parseVideoIllustrationDisplayMetadata(text: string) {
  const line = text.split(/\r?\n/).map((value) => value.trim()).find((value) => value.startsWith(VIDEO_ILLUSTRATION_DISPLAY_PREFIX));
  if (!line) return null;
  try {
    return parseVideoIllustrationReference(JSON.parse(line.slice(VIDEO_ILLUSTRATION_DISPLAY_PREFIX.length)));
  } catch {
    return null;
  }
}

export function videoIllustrationReferenceInstruction(reference: VideoIllustrationAiReference) {
  return [
    videoIllustrationDisplayMetadata(reference),
    `Apply the ${reference.id} skill contract from ${reference.repository}. Do not stop to ask whether the skill is installed: the required contract is embedded below.`,
    "Video illustration request:",
    "- Read the current video project's index.html and extract its central idea, factual anchors, labels, and visual tone before planning the illustration.",
    "- Invent one fresh visual metaphor for that idea. Create one standalone 16:9 Ian 小黑 HTML illustration: 小黑 is a solid-black figure with white dot eyes and thin limbs and must perform the core conceptual action, not stand nearby as decoration. Use a pure-white background, sparse black hand-drawn lines, restrained red/orange/blue handwritten Chinese notes, and ample whitespace. Avoid PPT layouts, commercial illustration, childish cuteness, dense diagrams, decorative title blocks, and copied example compositions.",
    "- Use the software's existing workspace file-reading and HTML-authoring capability. Do not call an image-generation extension, external image service, or API-key-backed provider.",
    "- Save exactly one self-contained HTML file under assets/video-illustrations/ with a collision-resistant descriptive filename. Do not overwrite an existing asset. The document must use inline HTML/CSS/SVG only, have no remote dependencies, network calls, scripts, timers, or animation, and render deterministically at 1600x900 while scaling responsively to fill its frame.",
    "- Include a valid doctype and a complete html/head/body document. Set body margin to 0, hide overflow, use a 16:9 canvas, and keep all illustration geometry inside the canvas. This file itself is the final asset; do not create a PNG or merely display markup in chat.",
    "- The saved HTML will automatically appear in Video Studio's illustration assets and can be dragged onto the video canvas. Do not edit index.html or place the asset on the timeline unless the user explicitly asks for placement.",
    "- After saving, read the file back from the exact project-relative path and confirm it exists before finishing. Your final response must include the Chinese sentence `插画已生成并放入素材库：<project-relative-path>` with the real saved path substituted; do not say that it merely should appear.",
  ].join("\n");
}

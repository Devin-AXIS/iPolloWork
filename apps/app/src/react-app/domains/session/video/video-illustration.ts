const VIDEO_ILLUSTRATION_DISPLAY_PREFIX = "Video illustration display:";

export const VIDEO_ILLUSTRATION_PROFILES = [
  {
    id: "ian-xiaohei-illustrations",
    label: "小黑手绘插画",
    repository: "helloianneo/ian-xiaohei-illustrations",
    skillContract: "ian-xiaohei-illustrations",
    direction: "Use the Ian 小黑 visual language: a solid-black figure with white dot eyes and thin limbs performs the central conceptual action on a pure-white background, with sparse hand-drawn lines, restrained red/orange/blue Chinese annotations, and ample whitespace.",
  },
  {
    id: "html-infographic",
    label: "信息图插画",
    repository: "openai/visualize",
    skillContract: "visualize",
    direction: "Create an editorial infographic that turns the video's real facts into a clear visual relationship, comparison, process, timeline, map, or compact data story. Prefer legible structure and meaningful encoding over decoration.",
  },
  {
    id: "html-concept-explainer",
    label: "概念解释插画",
    repository: "ipollowork/faceless-explainer",
    skillContract: "faceless-explainer + hyperframes-core",
    direction: "Create a faceless concept-explainer frame with one strong metaphor, a clear reading path, and an editable HyperFrames-compatible hierarchy. Explain the video's central mechanism rather than making a generic poster.",
  },
  {
    id: "html-kinetic-typography",
    label: "动态排版插画",
    repository: "heygen-com/hyperframes",
    skillContract: "hyperframes-animation",
    direction: "Create a typography-led illustration whose hierarchy, rhythm, and motion reinforce the video's key phrase. Motion must be finite, deterministic, and optional; the complete message remains visible and meaningful without animation.",
  },
  {
    id: "html-svg-path",
    label: "SVG 路径插画",
    repository: "heygen-com/hyperframes",
    skillContract: "hyperframes-keyframes",
    direction: "Create an inline-SVG path illustration using purposeful lines, routes, reveals, masks, or morph-ready geometry. Keep paths editable and make the untweened first frame a complete composition.",
  },
  {
    id: "html-3d-space",
    label: "3D 空间插画",
    repository: "heygen-com/hyperframes",
    skillContract: "hyperframes-keyframes",
    direction: "Create a lightweight spatial illustration using CSS perspective and inline SVG/HTML layers. Preserve readable depth, avoid external 3D engines, and provide a flat reduced-motion state with the same information.",
  },
] as const;

export type VideoIllustrationAiReference = {
  id: typeof VIDEO_ILLUSTRATION_PROFILES[number]["id"];
  label: string;
  repository: typeof VIDEO_ILLUSTRATION_PROFILES[number]["repository"];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseVideoIllustrationReference(value: unknown): VideoIllustrationAiReference | null {
  if (!isRecord(value) || typeof value.label !== "string" || !value.label.trim()) return null;
  const profile = VIDEO_ILLUSTRATION_PROFILES.find((candidate) => candidate.id === value.id);
  if (!profile || value.repository !== profile.repository) return null;
  return { id: profile.id, label: value.label.trim(), repository: profile.repository };
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
  const profile = VIDEO_ILLUSTRATION_PROFILES.find((candidate) => candidate.id === reference.id);
  if (!profile) return videoIllustrationDisplayMetadata(reference);
  return [
    videoIllustrationDisplayMetadata(reference),
    `Apply the embedded ${profile.skillContract} skill contract represented by ${reference.repository}. Do not stop to ask whether a skill package is installed and do not request an image API key.`,
    "Video illustration request:",
    "- Read the current video project's index.html and extract its central idea, factual anchors, labels, and visual tone before planning the illustration.",
    `- Style-specific direction: ${profile.direction}`,
    "- Use the software's existing workspace file-reading and HTML-authoring capability. Do not call an image-generation extension, external image service, or API-key-backed provider.",
    "- Save exactly one self-contained HTML file under assets/video-illustrations/ with a collision-resistant descriptive filename. Do not overwrite an existing asset. Use editable HTML/CSS/inline SVG; do not generate PNG or another raster substitute. The file must contain no CDN, remote font, network request, imported stylesheet, or external runtime/library.",
    "- Include one complete html/head/body document designed at 1600x900. Set body margin to 0 and hide overflow; use a root 1600:900 stage or SVG viewBox with responsive width/height and preserveAspectRatio `xMidYMid meet` so every visual remains visible during proportional scaling.",
    "- The complete composition must be visible and meaningful on its first frame. Optional inline CSS/JavaScript motion must be finite, deterministic, and presentation-only; implement `@media (prefers-reduced-motion: reduce)` so reduced-motion users receive the complete static state with no essential content hidden.",
    "- The saved HTML will automatically appear in Video Studio's illustration assets and can be dragged onto the video canvas. Do not edit index.html or place the asset on the timeline unless the user explicitly asks for placement.",
    "- After saving, read the file back from the exact project-relative path and confirm it exists before finishing. Your final response must include the Chinese sentence `插画已生成并放入素材库：<project-relative-path>` with the real saved path substituted; do not say that it merely should appear.",
  ].join("\n");
}

import type { PptxCompatibility, TemplateCategory, TemplateSessionSnapshot } from "@ipollowork/types/templates";

const TYPE_LABELS: Record<TemplateCategory, string> = {
  site: "网站",
  video: "视频",
  app: "应用界面",
  slides: "演示文稿",
  poster: "海报",
  cards: "卡片",
  report: "报告",
  article: "文章",
  other: "Design",
};

export function templateAuthoringTypeLabel(category: TemplateCategory, pptxCompatibility?: PptxCompatibility) {
  return pptxCompatibility ? "原生可编辑 PPT" : TYPE_LABELS[category];
}

export function templateAuthoringKickoff(category: TemplateCategory, pptxCompatibility?: PptxCompatibility) {
  const label = templateAuthoringTypeLabel(category, pptxCompatibility);
  const pluginWorkflow = category === "video"
    ? " The Video plugin-owned `ipollowork-video-template-authoring` Skill is required: load and follow it before editing any file. If that Skill is unavailable, stop and explain that iPollo Video must be installed or enabled; never replace it with a generic static HTML fallback."
    : "";
  return {
    text: `创建一个${label}模板`,
    instruction: `This is the first turn of a ${label} reusable-template authoring session. A minimal valid project already exists. Follow the injected authoring contract and its owning Skill.${pluginWorkflow}`,
  };
}

export function templateTypeRulesInstruction(category: TemplateCategory): string {
  if (category === "slides") {
    return "For slides, including HTML, follow ipollowork-presentations for the current task; read only applicable references relative to the installed Skill. Preserve the HTML runtime or native editable PPTX contract.";
  }
  if (category === "video") {
    return "Follow the active Video surface contract. Read ipollowork-video-studio once and load only applicable references relative to the installed Skill. Read copied template guides and catalogs only from exact paths inside the active project; do not search for missing template files. Reuse unchanged guidance and completed checks.";
  }
  return `Follow ipollowork-design-studio for this ${category} task; read only affected references relative to the installed Skill. The Skill owns creative, layout and media decisions; targeted edits preserve unrelated content and existing assets.`;
}

function surfaceRules(snapshot: TemplateSessionSnapshot) {
  const manifest = snapshot.manifest;
  if (manifest.surface === "video") {
    return `- The Video plugin-owned ipollowork-video-template-authoring Skill is mandatory for this session. If it cannot be loaded, stop instead of producing a generic fallback.
- Edit ${snapshot.state.entry} as one HyperFrames composition.
- Keep data-composition-id, width, height, duration, tracks, clips, and data-composition-variables valid.
- Every manifest content variable must match one declared HyperFrames variable, with a deterministic default.
- Include the local GSAP runtime and register one paused GSAP timeline in window.__timelines, with visible motivated timeline motion.
- Keep animation seek-safe and deterministic. Do not introduce ambient infinite animation or timing hidden outside the composition.`;
  }
  if (manifest.category === "slides") {
    return `- Edit ${snapshot.state.entry} as a fixed 16:9 stage with stable data-ipw-slide roots.
- Never change slide roots or geometry merely to apply a theme.
${manifest.pptxCompatibility ? "- This is native editable PPT mode. Keep data-pptx-text, data-pptx-shape, and data-pptx-image coverage for every exportable object. Do not permanently hide slide roots with display, visibility, or opacity rules; the Design panel owns page isolation." : "- This is an HTML presentation, not native PPT mode. Do not claim editable PPT export markers unless the manifest explicitly enables them."}`;
  }
  return `- Edit ${snapshot.state.entry} as semantic HTML. ${manifest.category === "poster" || manifest.category === "cards" ? "Preserve the requested canvas dimensions; scale fixed-canvas previews without reflowing their composition." : "Use responsive behavior appropriate to the target medium."}
- Consume stable --ipw-* tokens from ${manifest.designSystem.tokens ?? "design-tokens.css"}; keep local assets inside the session project.
- Preserve landmarks, links, forms, responsive behavior, and structural geometry while changing visual tokens.`;
}

export function templateAuthoringSystemContext(snapshot: TemplateSessionSnapshot, selectedDesignSystemGuide?: string | null) {
  if (!snapshot.authoring) return null;
  const manifest = snapshot.manifest;
  const label = templateAuthoringTypeLabel(manifest.category, manifest.pptxCompatibility);
  const variables = manifest.designSystem.variables.map((variable) => `${variable.id} (${variable.type})`).join(", ") || "none yet";
  const skill = manifest.category === "video" ? "ipollowork-video-studio" : manifest.category === "slides" ? "ipollowork-presentations" : "ipollowork-design-studio";
  return `# iPolloWork template authoring

The application has fixed this session as a ${label} template. Do not guess or convert its category or surface.

Follow the reusable-template authoring section of shared-guidelines.md relative to the installed ${skill} Skill. It owns the conversation and reusable-template guidance; ordinary artifact creation and targeted edits keep their requested scope.

Keep manifest.json, ${manifest.designSystem.tokens ?? "design-tokens.css"}, cover metadata, variables, and the apply checklist current after every structural change. Current declared variables: ${variables}.

${surfaceRules(snapshot)}

${templateTypeRulesInstruction(manifest.category)}

The server Manifest schema and validation report are the hard truth. Never work around a validation issue, change the category, or claim readiness without validating and re-instantiating the package.${selectedDesignSystemGuide?.trim() ? `

# Current selected Design System only
${selectedDesignSystemGuide.trim()}` : ""}`;
}

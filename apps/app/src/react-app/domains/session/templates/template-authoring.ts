import type { PptxCompatibility, TemplateCategory, TemplateSessionSnapshot } from "@ipollowork/types/templates";

const TYPE_LABELS: Record<TemplateCategory, string> = {
  site: "网站",
  video: "Video",
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
  return {
    text: `创建一个${label}模板`,
    instruction: `This is the first turn of a ${label} template-authoring session. A minimal valid project already exists. Start by acknowledging the goal, then ask exactly one unanswered question about purpose and audience. Do not ask for information the user already supplied.`,
  };
}

function surfaceRules(snapshot: TemplateSessionSnapshot) {
  const manifest = snapshot.manifest;
  if (manifest.surface === "video") {
    return `- Edit ${snapshot.state.entry} as one HyperFrames composition.
- Keep data-composition-id, width, height, duration, tracks, clips, and data-composition-variables valid.
- Every manifest content variable must match one declared HyperFrames variable, with a deterministic default.
- Keep animation seek-safe and deterministic. Do not introduce ambient infinite animation or timing hidden outside the composition.`;
  }
  if (manifest.category === "slides") {
    return `- Edit ${snapshot.state.entry} as a fixed 16:9 stage with stable data-ipw-slide roots.
- Never change slide roots or geometry merely to apply a theme.
${manifest.pptxCompatibility ? "- This is native editable PPT mode. Keep data-pptx-text, data-pptx-shape, and data-pptx-image coverage for every exportable object." : "- This is an HTML presentation, not native PPT mode. Do not claim editable PPT export markers unless the manifest explicitly enables them."}`;
  }
  return `- Edit ${snapshot.state.entry} as semantic, responsive HTML.
- Consume stable --ipw-* tokens from ${manifest.designSystem.tokens ?? "design-tokens.css"}; keep local assets inside the session project.
- Preserve landmarks, links, forms, responsive behavior, and structural geometry while changing visual tokens.`;
}

export function templateAuthoringSystemContext(snapshot: TemplateSessionSnapshot, selectedDesignSystemGuide?: string | null) {
  if (!snapshot.authoring) return null;
  const manifest = snapshot.manifest;
  const label = templateAuthoringTypeLabel(manifest.category, manifest.pptxCompatibility);
  const variables = manifest.designSystem.variables.map((variable) => `${variable.id} (${variable.type})`).join(", ") || "none yet";
  return `# iPolloWork template authoring

The application has fixed this session as a ${label} template. Do not guess or convert its category or surface.

Guide the conversation one critical question at a time in this order:
1. purpose and audience
2. reusable content structure
3. reusable variables
4. visual direction and Design System
5. type-specific requirements
6. generation and validation

Skip anything already answered. After enough information exists, edit the current project instead of continuing to interview.

Keep manifest.json, ${manifest.designSystem.tokens ?? "design-tokens.css"}, cover metadata, variables, and the apply checklist current after every structural change. Current declared variables: ${variables}.

${surfaceRules(snapshot)}

The server Manifest schema and validation report are the hard truth. Never work around a validation issue, change the category, or claim readiness without validating and re-instantiating the package.${selectedDesignSystemGuide?.trim() ? `

# Current selected Design System only
${selectedDesignSystemGuide.trim()}` : ""}`;
}

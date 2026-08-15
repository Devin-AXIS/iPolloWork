export type DesignAiSelectionContext = {
  id: string;
  sessionId: string;
  workspaceId: string;
  filePath: string;
  baseUpdatedAt: number | null;
  beforeHtml: string;
  target: {
    tag: string;
    label: string;
    locator: string;
    text: string;
    src: string;
    alt: string;
    styles: Record<string, string>;
  };
};

export type DesignAiUndoCheckpoint = {
  contextId: string;
  sessionId: string;
  workspaceId: string;
  filePath: string;
  baseUpdatedAt: number | null;
  beforeHtml: string;
  afterHtml: string;
  afterUpdatedAt: number | null;
};

const DESIGN_AI_SELECTION_TOKEN = /^\[\[design-ai:([a-zA-Z0-9_-]+)\]\]$/;
const DESIGN_AI_SELECTION_DISPLAY_PREFIX = "Design selection display:";

const DESIGN_HTML_THEME_TOKEN_LINES = [
  "- All generated or edited Design HTML must keep the shared theme stylesheet linked as `<link rel=\"stylesheet\" href=\"design-tokens.css\" data-ipw-design-tokens>` when the file lives beside that stylesheet. Keep it as the final stylesheet/style entry before `</head>` so the theme contract can override generated component CSS.",
  "- The current editable HTML file is the structural source of truth. Read it before editing and update its existing DOM and CSS in place.",
  "- Manual Studio edits are user-owned source state. Preserve `data-hf-id`, `data-hf-studio-*`, `--hf-studio-*`, inline geometry/transform values, and existing GSAP position/scale/rotation writes unless the request explicitly changes that exact element and property; never rebuild from an earlier or cached HTML snapshot.",
  "- Preserve the existing root classes, section hierarchy and order, template-specific class names, component geometry, artwork, responsive behavior, animation, and timing unless the user explicitly requests a structural redesign.",
  "- Replace content inside the selected template; never replace it with a generic hero, statistics row, feature cards, project grid, dashboard, or another standard scaffold.",
  "- Preserve the existing HTML skeleton and component structure when applying or adapting a design system; theme changes must flow through CSS custom properties, not a rewritten layout.",
  "- Use the iPolloWork HTML theme token contract for colors, typography, spacing, sizing, radii, shadows, cards, buttons, and backgrounds:",
  "  `--ipw-color-bg`, `--ipw-color-surface`, `--ipw-color-text`, `--ipw-color-muted`, `--ipw-color-border`, `--ipw-color-primary`, `--ipw-color-secondary`, `--ipw-color-accent`, `--ipw-color-success`, `--ipw-color-warning`, `--ipw-color-danger`, `--ipw-color-on-primary`, `--ipw-color-primary-soft`, `--ipw-bg-color`, `--ipw-bg-decoration-opacity`, `--ipw-bg-gradient`, `--ipw-bg-image`, `--ipw-bg-overlay`, `--ipw-font-display`, `--ipw-font-body`, `--ipw-type-scale`, `--ipw-body-line-height`, `--ipw-content-width`, `--ipw-page-padding`, `--ipw-section-space`, `--ipw-button-radius`, `--ipw-card-bg`, `--ipw-card-border`, `--ipw-card-radius`, `--ipw-card-shadow`, `--ipw-card-blur`.",
  "- Treat `--ipw-motion-style`, `--ipw-motion-duration`, `--ipw-motion-distance`, and `--ipw-motion-ease` as the shared video motion tokens; keep motion changes in the token stylesheet so the Studio theme controls can update them live.",
  "- Do not hardcode themeable hex/rgb/hsl colors, font families, gradients, border colors, border radii, card shadows, page width, or major spacing when one of the `--ipw-*` tokens represents the same role. This includes inline styles, pseudo-elements, SVG presentation colors, and `!important` declarations.",
  "- Mark visually important regions whose role is not obvious from semantic HTML with `data-ipw-theme-role`. Supported roles include `page`, `surface`, `card`, `heading`, `muted`, `accent`, `primary-action`, `secondary-action`, `on-primary`, and `border`.",
  "- In slide decks, every `[data-ipw-slide]`, `.slide`, and `.slide-frame` uses the shared theme canvas and text tokens by default. Do not assign a separate hardcoded or primary-color background to cover/title/closing slides unless the user explicitly requests alternating slide treatments.",
  "- Before finishing a generated Design HTML file, scan its CSS and inline `style` attributes. Themeable declarations must resolve through `var(--ipw-...)`; hardcoded colors are allowed only for non-theme artwork, photographs, logos, or data whose literal color carries meaning.",
  "- If a needed visual role is missing, add a new semantic `--ipw-*` token to `design-tokens.css` first, then reference it from HTML/CSS. Do not reference OpenDesign source token names directly in generated HTML.",
];

export function designHtmlThemeSystemContext(input?: {
  id?: string | null;
  category?: string | null;
  title?: string | null;
  entry?: string | null;
  tokenPath?: string | null;
  applyChecklist?: readonly string[] | null;
}) {
  const tokenPath = input?.tokenPath?.trim() || "design-tokens.css";
  const entryDirectory = input?.entry?.replace(/[\\/][^\\/]+$/, "") ?? "";
  return [
    "Design HTML theme contract:",
    input?.id ? `- Current design template id: ${input.id}.` : null,
    input?.category ? `- Current design category: ${input.category}.` : null,
    input?.title ? `- Current design template: ${input.title}.` : null,
    input?.entry ? `- Primary editable HTML file: ${input.entry}.` : null,
    input?.category === "slides" && entryDirectory
      ? `- Presentation output contract: use real file tools and keep every generated presentation source, supporting asset, and exported slide file inside \`${entryDirectory}\`. Do not return code without saving it to this session directory.`
      : null,
    `- Shared token stylesheet: ${tokenPath}.`,
    ...DESIGN_HTML_THEME_TOKEN_LINES,
    input?.applyChecklist?.length
      ? `- Template checklist still applies: ${input.applyChecklist.join("; ")}.`
      : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function designAiSelectionToken(id: string) {
  return `[[design-ai:${id}]]`;
}

export function parseDesignAiSelectionToken(token: string) {
  return DESIGN_AI_SELECTION_TOKEN.exec(token)?.[1] ?? null;
}

export function designAiSelectionDisplayMetadata(contextId: string, label: string) {
  return `${DESIGN_AI_SELECTION_DISPLAY_PREFIX}${JSON.stringify({ contextId, label })}`;
}

export function parseDesignAiSelectionDisplayMetadata(text: string) {
  const line = text.split(/\r?\n/, 1)[0]?.trim();
  if (!line?.startsWith(DESIGN_AI_SELECTION_DISPLAY_PREFIX)) return null;
  try {
    const parsed = JSON.parse(line.slice(DESIGN_AI_SELECTION_DISPLAY_PREFIX.length)) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const contextId = "contextId" in parsed ? (parsed as { contextId?: unknown }).contextId : null;
    const label = "label" in parsed ? (parsed as { label?: unknown }).label : null;
    if (typeof contextId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(contextId)) return null;
    if (typeof label !== "string" || !label.trim()) return null;
    return { contextId, label: label.trim() };
  } catch {
    return null;
  }
}

export function designAiSelectionInstruction(context: DesignAiSelectionContext) {
  return [
    designAiSelectionDisplayMetadata(context.id, context.target.label),
    "Design selection request:",
    `- Edit only the file: ${context.filePath}`,
    `- Edit only the selected element at CSS locator: ${context.target.locator}`,
    "- Do not modify any other element, page structure, slide, or file unless the user explicitly asks for a wider change.",
    "- If the locator no longer resolves in the file, stop without changing the file and ask the user to select the element again.",
    "- Preserve unrelated content and styles.",
    ...DESIGN_HTML_THEME_TOKEN_LINES,
  ].join("\n");
}

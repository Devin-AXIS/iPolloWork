import saasLandingSource from "./templates/open-design/saas-landing.html?raw";

export type DesignTemplate = {
  id: string;
  category: "site";
  subcategory: "landing" | "personal";
  title: string;
  source: { name: string; repository: string; license: string };
  fileName: string;
  html: string;
  applyChecklist: readonly string[];
};

const tokenBridge = `<style id="ipollowork-design-tokens">
:root {
  --ipw-color-bg: #fafaf9; --ipw-color-surface: #ffffff; --ipw-color-text: #1c1b1a;
  --ipw-color-muted: #6b6964; --ipw-color-border: #e6e4e0; --ipw-color-primary: #c96442;
  --ipw-font-display: -apple-system, system-ui, sans-serif; --ipw-font-body: -apple-system, system-ui, sans-serif;
  --ipw-radius: 14px; --ipw-space: 32px; --ipw-shadow: 0 12px 32px rgba(28,27,26,.10);
  --bg: var(--ipw-color-bg); --surface: var(--ipw-color-surface); --fg: var(--ipw-color-text);
  --muted: var(--ipw-color-muted); --border: var(--ipw-color-border); --accent: var(--ipw-color-primary);
}
body { font-family: var(--ipw-font-body); }
h1,h2,h3,h4,h5,h6 { font-family: var(--ipw-font-display); }
</style>`;

function withTokenBridge(html: string) {
  return html.replace("</head>", `${tokenBridge}</head>`);
}

export const DESIGN_TEMPLATES: readonly DesignTemplate[] = [
  {
    id: "open-design-saas-landing",
    category: "site",
    subcategory: "landing",
    title: "SaaS Landing",
    source: {
      name: "Open Design",
      repository: "https://github.com/nexu-io/open-design",
      license: "Apache-2.0",
    },
    fileName: "saas-landing.html",
    html: withTokenBridge(saasLandingSource),
    applyChecklist: [
      "document title and meta description",
      "brand mark and navigation labels",
      "hero heading, copy, and calls to action",
      "feature cards and proof content",
      "pricing or section labels",
      "footer copy and links",
      "global theme token values",
    ],
  },
];

export function getDesignTemplate(id: string | undefined) {
  return DESIGN_TEMPLATES.find((template) => template.id === id) ?? null;
}

import saasLandingSource from "./templates/open-design/saas-landing.html?raw";

export type DesignTemplate = {
  id: string;
  category: "site";
  subcategory: "landing" | "personal";
  title: string;
  source: { name: string; repository: string; license: string };
  fileName: string;
  html: string;
  designSystem: {
    tokenVersion: 1;
    editableGroups: readonly ["theme", "background", "typography", "components"];
  };
  applyChecklist: readonly string[];
};

const tokenBridge = \`<style id="ipollowork-design-tokens">
:root {
  --ipw-color-bg: #fafaf9; --ipw-color-surface: #ffffff; --ipw-color-text: #1c1b1a;
  --ipw-color-muted: #6b6964; --ipw-color-border: #e6e4e0; --ipw-color-primary: #c96442;
  --ipw-color-secondary: #2563eb; --ipw-color-accent: #7c3aed;
  --ipw-color-success: #059669; --ipw-color-warning: #d97706; --ipw-color-danger: #dc2626;
  --ipw-font-display: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --ipw-font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --ipw-type-scale: 1; --ipw-body-line-height: 1.55;
  --ipw-content-width: 1080px; --ipw-page-padding: 32px; --ipw-section-space: 80px;
  --ipw-button-radius: 8px; --ipw-card-bg: #ffffff; --ipw-card-border: #e6e4e0;
  --ipw-card-radius: 14px; --ipw-card-shadow: 0 12px 32px rgba(28,27,26,.10); --ipw-card-blur: 0px;
  --ipw-bg-gradient: none; --ipw-bg-image: none;
  --ipw-bg-overlay: linear-gradient(rgba(28,27,26,0), rgba(28,27,26,0));
  --ipw-bg-overlay-color: #1c1b1a; --ipw-bg-overlay-opacity: 0;
  --bg: var(--ipw-color-bg); --surface: var(--ipw-color-surface); --fg: var(--ipw-color-text);
  --muted: var(--ipw-color-muted); --border: var(--ipw-color-border); --accent: var(--ipw-color-primary);
}
html { background: var(--ipw-color-bg); }
body {
  min-height: 100%;
  font-family: var(--ipw-font-body);
  font-size: calc(16px * var(--ipw-type-scale));
  line-height: var(--ipw-body-line-height);
  background-color: var(--ipw-color-bg);
  background-image: var(--ipw-bg-overlay), var(--ipw-bg-image), var(--ipw-bg-gradient);
  background-size: cover;
  background-position: center;
  background-attachment: fixed;
}
h1,h2,h3,h4,h5,h6 { font-family: var(--ipw-font-display); }
.wrap { max-width: var(--ipw-content-width); padding-inline: var(--ipw-page-padding); }
section { padding-block: var(--ipw-section-space); }
button { border-radius: var(--ipw-button-radius); }
.btn-primary { background: var(--ipw-color-primary); border-color: var(--ipw-color-primary); }
.btn-secondary { background: var(--ipw-color-surface); border-color: var(--ipw-color-border); }
.btn-link { color: var(--ipw-color-primary); }
.tier, [data-ipw-card] {
  background: var(--ipw-card-bg);
  border-color: var(--ipw-card-border);
  border-radius: var(--ipw-card-radius);
  box-shadow: var(--ipw-card-shadow);
  backdrop-filter: blur(var(--ipw-card-blur));
  -webkit-backdrop-filter: blur(var(--ipw-card-blur));
}
.tier.featured { border-color: var(--ipw-color-primary); }
.tier.featured::before, .closing { background: var(--ipw-color-primary); }
</style>\`;

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
    designSystem: {
      tokenVersion: 1,
      editableGroups: ["theme", "background", "typography", "components"],
    },
    applyChecklist: [
      "document title and meta description",
      "brand mark and navigation labels",
      "responsive glass mobile navigation with a compact menu toggle",
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

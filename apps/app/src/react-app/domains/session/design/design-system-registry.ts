import { designSystemMarker } from "./design-system-theme-contract";

type DesignSystemManifest = {
  id: string;
  name: string;
  category: string;
  description?: string;
  preview?: {
    dir?: string;
    pages?: Array<{ path: string; role?: string; title?: string }>;
  };
  files?: {
    tokens?: string;
    designTokens?: string;
  };
};

export type DesignSystemTheme = {
  id: string;
  name: string;
  category: string;
  description: string;
  previewHtml: string;
  tokensCss: string;
};

export type DesignThemeTokenHints = {
  colors: string[];
  fonts: string[];
  lengths: string[];
  shadows: string[];
  byToken: Record<string, string[]>;
};

export type DesignSystemTokenControl = {
  name: string;
  storageName: string;
  value: string;
  group: string;
  kind: "color" | "font" | "length" | "shadow" | "text";
};

const TOKEN_GROUP_ORDER = [
  "表面", "文本", "边框", "强调色", "语义", "字体排印", "字号层级",
  "间距", "圆角", "层级阴影", "聚焦", "动效", "布局", "其他",
] as const;

const THEME_TOKEN_SOURCES: Record<string, readonly string[]> = {
  "--ipw-color-bg": ["--bg", "--page-bg", "--canvas"],
  "--ipw-color-surface": ["--surface", "--surface-1", "--panel"],
  "--ipw-color-text": ["--fg", "--text", "--text-1", "--on-surface"],
  "--ipw-color-muted": ["--muted", "--fg-2", "--text-muted", "--text-2"],
  "--ipw-color-border": ["--border", "--border-soft"],
  "--ipw-color-primary": ["--accent", "--primary", "--brand"],
  "--ipw-color-secondary": ["--secondary", "--accent-hover", "--accent"],
  "--ipw-color-accent": ["--meta", "--accent", "--highlight"],
  "--ipw-color-success": ["--success", "--good"],
  "--ipw-color-warning": ["--warn", "--warning"],
  "--ipw-color-danger": ["--danger", "--bad"],
  "--ipw-color-on-primary": ["--accent-on", "--on-accent", "--on-primary"],
  "--ipw-font-display": ["--font-display"],
  "--ipw-font-body": ["--font-body"],
  "--ipw-body-line-height": ["--leading-body"],
  "--ipw-content-width": ["--container-max"],
  "--ipw-page-padding": ["--container-gutter-desktop", "--container-gutter-tablet", "--container-gutter-phone"],
  "--ipw-section-space": ["--section-y-desktop", "--section-y-tablet", "--section-y-phone"],
  "--ipw-button-radius": ["--radius-pill", "--radius-md", "--radius-sm"],
  "--ipw-card-bg": ["--surface", "--surface-1", "--bg"],
  "--ipw-card-border": ["--border", "--border-soft"],
  "--ipw-card-radius": ["--radius-lg", "--radius-md", "--radius-sm"],
  "--ipw-card-shadow": ["--elev-raised", "--elev-ring", "--elev-flat"],
};

const manifestModules = import.meta.glob("./design-systems/design-systems/*/manifest.json", {
  eager: true,
  import: "default",
}) as Record<string, DesignSystemManifest>;

const kitPreviewModules = import.meta.glob("./design-systems/design-systems/*/system/kit.html", {
  eager: true,
  as: "raw",
}) as Record<string, string>;

const systemIndexModules = import.meta.glob("./design-systems/design-systems/*/system/index.html", {
  eager: true,
  as: "raw",
}) as Record<string, string>;

const previewModules = import.meta.glob("./design-systems/design-systems/*/preview/colors.html", {
  eager: true,
  as: "raw",
}) as Record<string, string>;

const tokenModules = import.meta.glob("./design-systems/design-systems/*/tokens.css", {
  eager: true,
  as: "raw",
}) as Record<string, string>;

function sortThemeItems(left: DesignSystemTheme, right: DesignSystemTheme) {
  const category = left.category.localeCompare(right.category);
  if (category !== 0) return category;
  return left.name.localeCompare(right.name);
}

export const DESIGN_SYSTEM_THEMES: DesignSystemTheme[] = Object.entries(manifestModules)
  .flatMap(([manifestPath, manifest]) => {
    const root = manifestPath.replace(/\/manifest\.json$/, "");
    const previewPath = `${root}/system/kit.html`;
    const previewFallbackPath = `${root}/system/index.html`;
    const legacyPreviewPath = `${root}/preview/colors.html`;
    const tokensPath = `${root}/tokens.css`;
    const previewHtml = kitPreviewModules[previewPath]
      ?? systemIndexModules[previewFallbackPath]
      ?? previewModules[legacyPreviewPath];
    const tokensCss = tokenModules[tokensPath];
    if (!previewHtml || !tokensCss) return [];
    return [{
      id: manifest.id,
      name: manifest.name,
      category: manifest.category,
      description: manifest.description ?? "",
      previewHtml,
      tokensCss,
    }];
  })
  .sort(sortThemeItems);

export function getDesignSystemTheme(themeId: string): DesignSystemTheme | undefined {
  return DESIGN_SYSTEM_THEMES.find((theme) => theme.id === themeId);
}

export function parseCssVariables(source: string) {
  const values: Record<string, string> = {};
  const pattern = /(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    values[match[1]] = match[2]?.trim() ?? "";
  }
  return values;
}

export function designSystemTokenStorageName(name: string) {
  return `--ipw-od-${name.replace(/^--/, "")}`;
}

function tokenGroup(name: string) {
  if (/^--(?:bg|surface(?:-|$)|page-bg|canvas|panel)/.test(name)) return "表面";
  if (/^--(?:fg(?:-|$)|muted|meta|text-muted|on-surface)/.test(name)) return "文本";
  if (/^--border/.test(name)) return "边框";
  if (/^--(?:accent|primary|secondary|brand|highlight)/.test(name)) return "强调色";
  if (/^--(?:success|warn|warning|danger|good|bad)/.test(name)) return "语义";
  if (/^--font/.test(name)) return "字体排印";
  if (/^--(?:text-|leading-|tracking-)/.test(name)) return "字号层级";
  if (/^--(?:space-|section-)/.test(name)) return "间距";
  if (/^--radius/.test(name)) return "圆角";
  if (/^--(?:elev|shadow)/.test(name)) return "层级阴影";
  if (/^--focus/.test(name)) return "聚焦";
  if (/^--(?:motion|ease)/.test(name)) return "动效";
  if (/^--container/.test(name)) return "布局";
  return "其他";
}

function tokenKind(name: string, value: string): DesignSystemTokenControl["kind"] {
  if (isColorTokenValue(value) || /(?:bg|surface|fg|muted|meta|border|accent|primary|secondary|success|warn|danger|good|bad)/.test(name)) return "color";
  if (/^--font/.test(name)) return "font";
  if (/^--(?:elev|shadow|focus)/.test(name)) return "shadow";
  if (isLengthTokenValue(value) || /^(?:--text-|--space-|--section-|--radius|--container)/.test(name)) return "length";
  return "text";
}

export function buildDesignSystemTokenControls(theme: DesignSystemTheme): DesignSystemTokenControl[] {
  const tokens = parseCssVariables(theme.tokensCss);
  return Object.entries(tokens)
    .map(([name, value]) => ({
      name,
      storageName: designSystemTokenStorageName(name),
      value,
      group: tokenGroup(name),
      kind: tokenKind(name, value),
    }))
    .sort((left, right) => {
      const group = TOKEN_GROUP_ORDER.indexOf(left.group as typeof TOKEN_GROUP_ORDER[number])
        - TOKEN_GROUP_ORDER.indexOf(right.group as typeof TOKEN_GROUP_ORDER[number]);
      return group || left.name.localeCompare(right.name);
    });
}

function rewriteThemeTokenReferences(value: string) {
  return value.replace(/var\(\s*(--[a-zA-Z0-9_-]+)/g, (_match, name: string) => `var(${designSystemTokenStorageName(name)}`);
}

function themeTokenReference(tokens: Record<string, string>, names: string[], fallback: string) {
  const name = names.find((candidate) => tokens[candidate] !== undefined);
  return name ? `var(${designSystemTokenStorageName(name)})` : fallback;
}

function isColorTokenValue(value: string) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim())
    || /^rgba?\(/i.test(value.trim())
    || /^hsla?\(/i.test(value.trim())
    || value.includes("color-mix(");
}

function isFontTokenValue(value: string) {
  return /,/.test(value) && /(?:sans|serif|mono|display|ui-|system-ui|apple-system|inter|georgia|helvetica|arial)/i.test(value);
}

function isLengthTokenValue(value: string) {
  return /^-?\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%)?$/.test(value.trim());
}

function isShadowTokenValue(value: string) {
  const trimmed = value.trim();
  return trimmed !== "none" && /(?:rgba?\(|hsla?\(|color-mix\(|\b\d+px\b)/i.test(trimmed) && /\b(?:inset|px)\b/i.test(trimmed);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineTokensIntoPreview(previewHtml: string, tokensCss: string) {
  const escapedCss = escapeHtml(tokensCss);
  return previewHtml.replace(
    /<link\b[^>]*href=["'][^"']*tokens\.css["'][^>]*>/i,
    `<style id="design-system-preview-tokens">${escapedCss}</style>`,
  );
}

export function buildDesignSystemPreviewDoc(theme: DesignSystemTheme) {
  return inlineTokensIntoPreview(theme.previewHtml, theme.tokensCss);
}

export function buildThemeTokenHints(theme: DesignSystemTheme): DesignThemeTokenHints {
  const tokens = parseCssVariables(theme.tokensCss);
  const colors = new Set<string>();
  const fonts = new Set<string>();
  const lengths = new Set<string>();
  const shadows = new Set<string>();
  for (const [name, value] of Object.entries(tokens)) {
    if (isColorTokenValue(value)) colors.add(value);
    if (isFontTokenValue(value)) fonts.add(value);
    if (isLengthTokenValue(value)) lengths.add(value);
    if (isShadowTokenValue(value) || name.includes("shadow") || name.includes("elev")) shadows.add(value);
  }
  const byToken = Object.fromEntries(Object.entries(THEME_TOKEN_SOURCES).map(([target, sources]) => {
    const exact = sources.map((source) => tokens[source]).filter((value): value is string => Boolean(value));
    const family = target.includes("color") || target.endsWith("-bg") || target.endsWith("-border")
      ? [...colors]
      : target.includes("font")
        ? [...fonts]
        : target.includes("shadow")
          ? [...shadows]
          : [...lengths];
    return [target, [...new Set([...exact, ...family])]];
  }));
  return {
    colors: [...colors],
    fonts: [...fonts],
    lengths: [...lengths],
    shadows: [...shadows],
    byToken,
  };
}

export function buildDesignSystemCardPreviewDoc(theme: DesignSystemTheme) {
  const tokens = parseCssVariables(theme.tokensCss);
  const bg = pickThemeToken(tokens, ["--bg", "--page-bg", "--canvas"], "#ffffff");
  const surface = pickThemeToken(tokens, ["--surface", "--surface-1", "--panel"], "#f7f7f5");
  const text = pickThemeToken(tokens, ["--fg", "--text", "--on-surface"], "#151515");
  const muted = pickThemeToken(tokens, ["--muted", "--fg-2", "--text-muted"], "#6b6b68");
  const border = pickThemeToken(tokens, ["--border", "--border-soft"], "#deded9");
  const accent = pickThemeToken(tokens, ["--accent", "--primary", "--brand"], "#f04f23");
  const radius = pickThemeToken(tokens, ["--radius-lg", "--radius-md"], "14px");
  const fontBody = pickThemeToken(tokens, ["--font-body"], 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif');
  const fontDisplay = pickThemeToken(tokens, ["--font-display", "--font-body"], fontBody);
  const safeName = escapeHtml(theme.name);
  const safeCategory = escapeHtml(theme.category);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      --od-card-bg: ${bg};
      --od-card-surface: ${surface};
      --od-card-text: ${text};
      --od-card-muted: ${muted};
      --od-card-border: ${border};
      --od-card-accent: ${accent};
      --od-card-radius: ${radius};
      --od-card-font-body: ${fontBody};
      --od-card-font-display: ${fontDisplay};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: transparent;
      color: var(--od-card-text);
      font-family: var(--od-card-font-body);
      -webkit-font-smoothing: antialiased;
    }
    .preview {
      width: 100%;
      height: 100vh;
      padding: 14px;
      background: radial-gradient(circle at 10% 0, color-mix(in srgb, var(--od-card-accent) 12%, transparent), transparent 34%), var(--od-card-bg);
    }
    .browser {
      height: 100%;
      overflow: hidden;
      border: 1px solid var(--od-card-border);
      border-radius: min(18px, var(--od-card-radius));
      background: color-mix(in srgb, var(--od-card-bg) 88%, white);
      box-shadow: 0 18px 55px rgba(15, 17, 23, .08);
    }
    .chrome {
      display: flex;
      gap: 6px;
      height: 22px;
      align-items: center;
      border-bottom: 1px solid var(--od-card-border);
      padding: 0 14px;
      background: color-mix(in srgb, var(--od-card-surface) 80%, white);
    }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--od-card-accent) 28%, var(--od-card-border));
    }
    .body { padding: 18px 16px 16px; }
    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .brand {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 8px;
      color: var(--od-card-accent);
      font-size: 12px;
      font-weight: 760;
    }
    .mark {
      width: 15px;
      height: 15px;
      flex: 0 0 auto;
      border-radius: 5px;
      background: var(--od-card-accent);
    }
    .pill {
      border: 1px solid color-mix(in srgb, var(--od-card-accent) 25%, var(--od-card-border));
      border-radius: 999px;
      padding: 5px 9px;
      color: var(--od-card-accent);
      font-size: 10px;
      font-weight: 720;
      white-space: nowrap;
    }
    h1 {
      margin: 16px 0 12px;
      color: var(--od-card-accent);
      font-family: var(--od-card-font-display);
      font-size: 22px;
      line-height: 1.08;
      letter-spacing: 0;
    }
    .actions {
      display: flex;
      gap: 8px;
      margin-bottom: 14px;
    }
    .button {
      min-width: 76px;
      border-radius: calc(min(16px, var(--od-card-radius)) * .65);
      padding: 8px 10px;
      background: var(--od-card-accent);
      color: #fff;
      font-size: 10px;
      font-weight: 760;
      text-align: center;
    }
    .button.secondary {
      border: 1px solid var(--od-card-border);
      background: transparent;
      color: var(--od-card-accent);
    }
    .tiles {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }
    .tile {
      min-height: 48px;
      border: 1px solid var(--od-card-border);
      border-radius: calc(min(18px, var(--od-card-radius)) * .72);
      background: var(--od-card-surface);
      padding: 10px;
    }
    .chip {
      width: 18px;
      height: 18px;
      border-radius: 7px;
      background: var(--od-card-accent);
    }
    .line {
      height: 7px;
      margin-top: 9px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--od-card-accent) 16%, var(--od-card-border));
    }
  </style>
</head>
<body>
  <div class="preview">
    <section class="browser">
      <div class="chrome"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
      <div class="body">
        <div class="top">
          <div class="brand"><span class="mark"></span><span>${safeName}</span></div>
          <div class="pill">${safeCategory}</div>
        </div>
        <h1>Build something people love.</h1>
        <div class="actions"><div class="button">Get started</div><div class="button secondary">Learn more</div></div>
        <div class="tiles">
          <div class="tile"><div class="chip"></div><div class="line"></div></div>
          <div class="tile"><div class="chip"></div><div class="line"></div></div>
          <div class="tile"><div class="chip"></div><div class="line"></div></div>
        </div>
      </div>
    </section>
  </div>
</body>
</html>`;
}

function pickThemeToken(values: Record<string, string>, names: string[], fallback: string) {
  for (const name of names) {
    if (values[name]) return values[name];
  }
  return fallback;
}

export function buildTemplateTokenCss(theme: DesignSystemTheme) {
  const tokens = parseCssVariables(theme.tokensCss);
  const sourceTokenLines = Object.entries(tokens).map(([name, value]) =>
    `  ${designSystemTokenStorageName(name)}: ${rewriteThemeTokenReferences(value)};`,
  );
  const lines = [
    designSystemMarker(theme.id),
    `:root {`,
    ...sourceTokenLines,
    ``,
    `  --ipw-color-bg: ${themeTokenReference(tokens, ["--bg", "--page-bg", "--canvas"], "#fafaf9")};`,
    `  --ipw-color-surface: ${themeTokenReference(tokens, ["--surface", "--surface-1", "--panel"], "#ffffff")};`,
    `  --ipw-color-text: ${themeTokenReference(tokens, ["--fg", "--text", "--on-surface"], "#1c1b1a")};`,
    `  --ipw-color-muted: ${themeTokenReference(tokens, ["--muted", "--fg-2", "--text-muted"], "#6b6964")};`,
    `  --ipw-color-border: ${themeTokenReference(tokens, ["--border", "--border-soft"], "#e6e4e0")};`,
    `  --ipw-color-primary: ${themeTokenReference(tokens, ["--accent", "--primary", "--brand"], "#c96442")};`,
    `  --ipw-color-secondary: ${themeTokenReference(tokens, ["--secondary", "--accent-hover", "--accent"], "#2563eb")};`,
    `  --ipw-color-accent: ${themeTokenReference(tokens, ["--meta", "--accent", "--highlight"], "#7c3aed")};`,
    `  --ipw-color-success: ${themeTokenReference(tokens, ["--success", "--good"], "#059669")};`,
    `  --ipw-color-warning: ${themeTokenReference(tokens, ["--warn", "--warning"], "#d97706")};`,
    `  --ipw-color-danger: ${themeTokenReference(tokens, ["--danger", "--bad"], "#dc2626")};`,
    `  --ipw-color-on-primary: ${themeTokenReference(tokens, ["--accent-on", "--on-accent", "--on-primary"], "#ffffff")};`,
    `  --ipw-color-primary-soft: color-mix(in srgb, var(--ipw-color-primary) 12%, var(--ipw-color-bg));`,
    `  --ipw-bg-gradient: none;`,
    `  --ipw-bg-image: none;`,
    `  --ipw-bg-overlay: linear-gradient(rgba(28,27,26,0), rgba(28,27,26,0));`,
    `  --ipw-bg-overlay-color: var(--ipw-color-text);`,
    `  --ipw-bg-overlay-opacity: 0;`,
    `  --ipw-font-display: ${themeTokenReference(tokens, ["--font-display"], '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif')};`,
    `  --ipw-font-body: ${themeTokenReference(tokens, ["--font-body"], '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif')};`,
    `  --ipw-type-scale: 1;`,
    `  --ipw-body-line-height: ${themeTokenReference(tokens, ["--leading-body"], "1.55")};`,
    `  --ipw-content-width: ${themeTokenReference(tokens, ["--container-max"], "1080px")};`,
    `  --ipw-page-padding: ${themeTokenReference(tokens, ["--container-gutter-desktop", "--container-gutter-tablet"], "32px")};`,
    `  --ipw-section-space: ${themeTokenReference(tokens, ["--section-y-desktop", "--section-y-tablet"], "80px")};`,
    `  --ipw-button-radius: ${themeTokenReference(tokens, ["--radius-pill", "--radius-md"], "8px")};`,
    `  --ipw-card-bg: ${themeTokenReference(tokens, ["--surface", "--bg"], "#ffffff")};`,
    `  --ipw-card-border: ${themeTokenReference(tokens, ["--border", "--border-soft"], "#e6e4e0")};`,
    `  --ipw-card-radius: ${themeTokenReference(tokens, ["--radius-lg", "--radius-md"], "14px")};`,
    `  --ipw-card-shadow: ${themeTokenReference(tokens, ["--elev-raised", "--elev-ring"], "0 12px 32px rgba(28,27,26,.10)")};`,
    `  --ipw-card-blur: 0px;`,
    `}`,
    ``,
    `/* Bridge common AI-generated token names back to the stable iPolloWork contract.`,
    `   Important aliases win over later inline theme declarations without changing layout. */`,
    `html:root, html:root body, html:root [class] {`,
    `  --bg: var(--ipw-color-bg) !important;`,
    `  --page-bg: var(--ipw-color-bg) !important;`,
    `  --canvas: var(--ipw-color-bg) !important;`,
    `  --bg-soft: var(--ipw-color-primary-soft) !important;`,
    `  --surface: var(--ipw-color-surface) !important;`,
    `  --surface-1: var(--ipw-color-surface) !important;`,
    `  --surface-2: color-mix(in srgb, var(--ipw-color-surface) 82%, var(--ipw-color-bg)) !important;`,
    `  --panel: var(--ipw-color-surface) !important;`,
    `  --fg: var(--ipw-color-text) !important;`,
    `  --text: var(--ipw-color-text) !important;`,
    `  --text-1: var(--ipw-color-text) !important;`,
    `  --fg-2: var(--ipw-color-muted) !important;`,
    `  --text-2: var(--ipw-color-muted) !important;`,
    `  --text-3: color-mix(in srgb, var(--ipw-color-muted) 72%, var(--ipw-color-bg)) !important;`,
    `  --muted: var(--ipw-color-muted) !important;`,
    `  --text-muted: var(--ipw-color-muted) !important;`,
    `  --border: var(--ipw-color-border) !important;`,
    `  --border-soft: color-mix(in srgb, var(--ipw-color-border) 72%, transparent) !important;`,
    `  --border-strong: color-mix(in srgb, var(--ipw-color-border) 72%, var(--ipw-color-text)) !important;`,
    `  --accent: var(--ipw-color-primary) !important;`,
    `  --accent-2: var(--ipw-color-secondary) !important;`,
    `  --accent-3: var(--ipw-color-accent) !important;`,
    `  --primary: var(--ipw-color-primary) !important;`,
    `  --brand: var(--ipw-color-primary) !important;`,
    `  --secondary: var(--ipw-color-secondary) !important;`,
    `  --good: var(--ipw-color-success) !important;`,
    `  --success: var(--ipw-color-success) !important;`,
    `  --warn: var(--ipw-color-warning) !important;`,
    `  --warning: var(--ipw-color-warning) !important;`,
    `  --bad: var(--ipw-color-danger) !important;`,
    `  --danger: var(--ipw-color-danger) !important;`,
    `  --grad: linear-gradient(135deg, var(--ipw-color-primary), var(--ipw-color-secondary) 55%, var(--ipw-color-accent)) !important;`,
    `  --grad-soft: linear-gradient(135deg, var(--ipw-color-primary-soft), color-mix(in srgb, var(--ipw-color-secondary) 10%, var(--ipw-color-bg))) !important;`,
    `  --font-display: var(--ipw-font-display) !important;`,
    `  --font-body: var(--ipw-font-body) !important;`,
    `  --container-max: var(--ipw-content-width) !important;`,
    `  --radius-sm: min(var(--ipw-button-radius), var(--ipw-card-radius)) !important;`,
    `  --radius-md: var(--ipw-button-radius) !important;`,
    `  --radius-lg: var(--ipw-card-radius) !important;`,
    `  --shadow: var(--ipw-card-shadow) !important;`,
    `  --shadow-lg: var(--ipw-card-shadow) !important;`,
    `}`,
    ``,
    `html:root, html:root body {`,
    `  background-color: var(--ipw-color-bg) !important;`,
    `  color: var(--ipw-color-text) !important;`,
    `  font-family: var(--ipw-font-body) !important;`,
    `  line-height: var(--ipw-body-line-height);`,
    `}`,
    `html:root body {`,
    `  background-image: var(--ipw-bg-overlay), var(--ipw-bg-image), var(--ipw-bg-gradient) !important;`,
    `}`,
    `html:root :where(h1, h2, h3, h4, h5, h6, [data-ipw-theme-role="heading"]) { font-family: var(--ipw-font-display) !important; }`,
    `html:root :where(button, [role="button"], [class*="button"], [class*="btn"]) { border-radius: var(--ipw-button-radius) !important; }`,
    `html:root :where([data-ipw-theme-role="page"], .shell, .page, .app-shell) { background-color: var(--ipw-color-bg) !important; color: var(--ipw-color-text) !important; }`,
    `html:root :where([data-ipw-slide], section.slide, .slide-frame) { background: var(--ipw-color-bg) !important; color: var(--ipw-color-text) !important; }`,
    `html:root :where([data-ipw-theme-role="surface"], [data-ipw-theme-role="card"], article, [class~="card"], [class*="-card"], [class~="panel"], [class*="-panel"], [class~="tile"], [class~="task"]) {`,
    `  background-color: var(--ipw-card-bg) !important;`,
    `  border-color: var(--ipw-card-border) !important;`,
    `  border-radius: var(--ipw-card-radius) !important;`,
    `  box-shadow: var(--ipw-card-shadow) !important;`,
    `  backdrop-filter: blur(var(--ipw-card-blur));`,
    `}`,
    `html:root :where([data-ipw-theme-role="primary-action"], .primary, .cta-primary, .button-primary, .btn-primary) { background-color: var(--ipw-color-primary) !important; border-color: var(--ipw-color-primary) !important; color: var(--ipw-color-on-primary) !important; }`,
    `html:root :where([data-ipw-theme-role="secondary-action"], .secondary, .quiet, .button-secondary, .btn-secondary) { background-color: var(--ipw-color-surface) !important; border-color: var(--ipw-color-border) !important; color: var(--ipw-color-text) !important; }`,
    `html:root :where([data-ipw-theme-role="muted"], .muted, .subtle, .lede, .subtitle, .description) { color: var(--ipw-color-muted) !important; }`,
    `html:root :where([data-ipw-theme-role="accent"], .eyebrow, .kicker, [class~="accent"]) { color: var(--ipw-color-accent) !important; }`,
    `html:root :where([data-ipw-theme-role="on-primary"], .primary > *, .cta-primary > *) { color: var(--ipw-color-on-primary) !important; }`,
    `html:root :where([data-ipw-theme-role="border"]) { border-color: var(--ipw-color-border) !important; }`,
  ];
  return lines.join("\n");
}

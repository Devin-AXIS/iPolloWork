export type HtmlPreviewMode = "document" | "slides";

export const SLIDE_PREVIEW_WIDTH = 1600;
export const SLIDE_PREVIEW_HEIGHT = 900;

const SLIDES_TEMPLATE_KIND_PATTERN = /\bdata-ipw-template-kind\s*=\s*(?:["']slides["']|slides\b)/i;
const STYLESHEET_LINK_PATTERN = /<link\b(?=[^>]*\brel\s*=\s*["']?stylesheet\b)[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i;

export function htmlPreviewMode(source: string): HtmlPreviewMode {
  return SLIDES_TEMPLATE_KIND_PATTERN.test(source) ? "slides" : "document";
}

export function slidePreviewScale(availableWidth: number, availableHeight: number) {
  if (availableWidth <= 0 || availableHeight <= 0) return 0;
  return Math.min(availableWidth / SLIDE_PREVIEW_WIDTH, availableHeight / SLIDE_PREVIEW_HEIGHT);
}

export function linkedHtmlPreviewStylesheetPath(entryPath: string, source: string) {
  const href = source.match(STYLESHEET_LINK_PATTERN)?.[1]?.trim() ?? "";
  if (!href || href.startsWith("/") || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href) || href.split("/").includes("..")) return "";
  const directory = entryPath.replace(/[^/]+$/, "");
  return `${directory}${href.replace(/^\.\//, "")}`;
}

export function inlineHtmlPreviewStylesheet(source: string, stylesheet: string) {
  if (!stylesheet.trim()) return source;
  const style = `<style data-ipw-preview-stylesheet>${stylesheet.replace(/<\/style/gi, "<\\/style")}</style>`;
  return source.replace(STYLESHEET_LINK_PATTERN, style);
}

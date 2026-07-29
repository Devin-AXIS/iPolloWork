export type DesignTokenValues = Record<string, string>;

const THEME_START = "/* ipw-theme:start */";
const THEME_END = "/* ipw-theme:end */";
const CUSTOM_PROPERTY_PATTERN = /(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+)\s*(?=;|\})/g;

function attributeValue(tag: string, name: string) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function themeBlock(source: string) {
  const start = source.indexOf(THEME_START);
  if (start < 0) return null;
  const end = source.indexOf(THEME_END, start + THEME_START.length);
  if (end < 0) return null;
  return {
    start,
    end: end + THEME_END.length,
    content: source.slice(start, end + THEME_END.length),
  };
}

function escapedPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function linkedDesignTokenPath(html: string) {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const href = attributeValue(tag, "href");
    if (!href) continue;
    const rel = attributeValue(tag, "rel");
    const isTokenLink = /\bdata-ipw-design-tokens\b/i.test(tag)
      || (rel?.split(/\s+/).some((value) => value.toLowerCase() === "stylesheet")
        && /(?:^|\/)design-tokens\.css(?:[?#].*)?$/i.test(href));
    if (isTokenLink) return href;
  }
  return null;
}

export function parseDesignTokenValues(source: string) {
  const values: DesignTokenValues = {};
  for (const match of source.matchAll(CUSTOM_PROPERTY_PATTERN)) {
    const name = match[1];
    const value = match[2];
    if (name && value) values[name] = value.trim();
  }
  return values;
}

export function replaceDesignTokenValue(source: string, name: string, value: string) {
  if (!/^--[A-Za-z0-9_-]+$/.test(name)) return source;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const declaration = new RegExp(`(${escapedPattern(name)}\\s*:\\s*)([^;{}]*)(;)`);
  if (declaration.test(source)) {
    return source.replace(
      declaration,
      (_match: string, prefix: string, _current: string, suffix: string) => `${prefix}${value}${suffix}`,
    );
  }

  const root = /:root\s*\{[\s\S]*?\}/.exec(source);
  if (!root || root.index === undefined) {
    const separator = source.trim().length > 0 ? `${newline}${newline}` : "";
    return `${source.trimEnd()}${separator}:root {${newline}  ${name}: ${value};${newline}}${newline}`;
  }

  const closingBrace = root.index + root[0].lastIndexOf("}");
  const before = source.slice(0, closingBrace);
  const leadingNewline = before.endsWith("\n") ? "" : newline;
  return `${before}${leadingNewline}  ${name}: ${value};${newline}${source.slice(closingBrace)}`;
}

export function mergeTemplateTokenCss(existing: string, next: string) {
  const incoming = themeBlock(next);
  if (!incoming) return existing;

  const current = themeBlock(existing);
  if (current) {
    return `${existing.slice(0, current.start)}${incoming.content}${existing.slice(current.end)}`;
  }

  const incomingNames = new Set(Object.keys(parseDesignTokenValues(incoming.content)));
  const structuralCss = existing.replace(
    CUSTOM_PROPERTY_PATTERN,
    (declaration: string, name: string) => incomingNames.has(name) ? "" : declaration,
  );
  const newline = existing.includes("\r\n") ? "\r\n" : "\n";
  const separator = structuralCss.trim().length > 0 ? `${newline}${newline}` : newline;
  return `${incoming.content}${separator}${structuralCss.trimStart()}`;
}

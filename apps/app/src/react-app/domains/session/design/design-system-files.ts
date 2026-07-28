export type DesignTokenValues = Record<string, string>;

const THEME_BLOCK_PATTERN = /\/\*\s*ipw-theme:start\s*\*\/[\s\S]*?\/\*\s*ipw-theme:end\s*\*\//i;
const MANAGED_PROPERTY_PATTERN = /(--ipw-[A-Za-z0-9_-]+)\s*:\s*([^;{}]+)\s*(?=;|\})/g;

function attributeValue(tag: string, name: string) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function themeBlock(source: string) {
  const match = THEME_BLOCK_PATTERN.exec(source);
  if (!match || match.index === undefined) return null;
  return {
    start: match.index,
    end: match.index + match[0].length,
    content: match[0],
  };
}

function escapedPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeLocalPath(path: string) {
  if (!path || path.startsWith("/") || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path)) return "";
  const pathname = path.split(/[?#]/, 1)[0] ?? "";
  if (pathname.split("/").includes("..")) return "";
  return path.replace(/^\.\//, "");
}

export function linkedDesignTokenPath(source: string | undefined): string {
  for (const tag of source?.match(/<link\b[^>]*>/gi) ?? []) {
    const href = attributeValue(tag, "href")?.trim();
    if (!href) continue;
    const rel = attributeValue(tag, "rel");
    const isTokenLink = /\bdata-ipw-design-tokens\b/i.test(tag)
      || (rel?.split(/\s+/).some((value) => value.toLowerCase() === "stylesheet")
        && /(?:^|\/)design-tokens?\.css(?:[?#].*)?$/i.test(href));
    if (!isTokenLink) continue;
    const path = safeLocalPath(href);
    if (path) return path;
  }
  return "";
}

export function parseDesignTokenValues(source: string | undefined): DesignTokenValues {
  const values: DesignTokenValues = {};
  for (const match of (source ?? "").matchAll(MANAGED_PROPERTY_PATTERN)) {
    const name = match[1];
    const value = match[2];
    if (name && value) values[name] = value.trim();
  }
  return values;
}

export function replaceDesignTokenValue(source: string, name: string, value: string) {
  if (!/^--ipw-[A-Za-z0-9_-]+$/.test(name)) return source;
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

function removeLegacyIpwRootDeclarations(source: string) {
  return source.replace(/:root\s*\{([\s\S]*?)\}/gi, (_block, body: string) => {
    const declarations = body
      .split(";")
      .map((declaration) => declaration.trim())
      .filter((declaration) => declaration && !declaration.startsWith("--ipw-"));
    return declarations.length ? `:root {\n  ${declarations.join(";\n  ")};\n}` : "";
  });
}

export function mergeTemplateTokenCss(existingCss: string | undefined, generatedThemeCss: string) {
  const incoming = themeBlock(generatedThemeCss);
  const existing = existingCss ?? "";
  if (!incoming) return existing;

  const current = themeBlock(existing);
  if (current) {
    return `${existing.slice(0, current.start)}${incoming.content}${existing.slice(current.end)}`;
  }

  const newline = existing.includes("\r\n") ? "\r\n" : "\n";
  const preserved = removeLegacyIpwRootDeclarations(existing).trim();
  return preserved
    ? `${incoming.content}${newline}${newline}${preserved}${newline}`
    : `${incoming.content}${newline}`;
}

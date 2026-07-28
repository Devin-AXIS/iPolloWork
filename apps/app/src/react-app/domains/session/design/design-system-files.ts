export type DesignTokenValues = Record<string, string>;

export function linkedDesignTokenPath(source: string | undefined): string {
  const path = source?.match(/<link\b[^>]*\bhref=["']([^"']*design-tokens?\.css)["'][^>]*>/i)?.[1]?.trim() ?? "";
  if (!path || path.startsWith("/") || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path) || path.split("/").includes("..")) return "";
  return path.replace(/^\.\//, "");
}

export function parseDesignTokenValues(source: string | undefined): DesignTokenValues {
  const values: DesignTokenValues = {};
  const pattern = /(--ipw-[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source ?? ""))) values[match[1]] = match[2]?.trim() ?? "";
  return values;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function replaceDesignTokenValue(source: string, name: string, value: string) {
  const css = source.trim() ? source : ":root {\n}\n";
  const tokenPattern = new RegExp(`(${escapeRegex(name)}\\s*:\\s*)([^;]*)(;)`);
  if (tokenPattern.test(css)) return css.replace(tokenPattern, `$1${value}$3`);
  const rootEnd = css.lastIndexOf("}");
  if (rootEnd >= 0) return `${css.slice(0, rootEnd)}  ${name}: ${value};\n${css.slice(rootEnd)}`;
  return `${css}\n:root {\n  ${name}: ${value};\n}\n`;
}

const THEME_BLOCK_PATTERN = /\/\*\s*ipw-theme:start\s*\*\/[\s\S]*?\/\*\s*ipw-theme:end\s*\*\//i;

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
  const generated = generatedThemeCss.trim();
  const existing = existingCss?.trim() ?? "";
  if (!existing) return `${generated}\n`;
  if (THEME_BLOCK_PATTERN.test(existing)) {
    return `${existing.replace(THEME_BLOCK_PATTERN, generated).trim()}\n`;
  }
  const preserved = removeLegacyIpwRootDeclarations(existing).trim();
  return preserved ? `${generated}\n\n${preserved}\n` : `${generated}\n`;
}

export function refreshTemplateTokenCss(existingCss: string | undefined, generatedThemeCss: string) {
  const currentValues = parseDesignTokenValues(existingCss);
  let refreshed = mergeTemplateTokenCss(existingCss, generatedThemeCss);
  for (const [name, value] of Object.entries(currentValues)) refreshed = replaceDesignTokenValue(refreshed, name, value);
  return refreshed;
}

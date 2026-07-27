const DESIGN_SYSTEM_MARKER = "ipw-design-system";

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function readAppliedDesignSystemId(source: string | undefined) {
  const match = source?.match(new RegExp(`/\\*\\s*${DESIGN_SYSTEM_MARKER}\\s*:\\s*([^*\\s]+)\\s*\\*/`, "i"));
  return match?.[1]?.trim() ?? null;
}

export function designSystemMarker(themeId: string) {
  return `/* ${DESIGN_SYSTEM_MARKER}: ${themeId} */`;
}

export function ensureHtmlDesignSystemContract(source: string, themeId: string, tokenHref = "design-tokens.css") {
  let next = source;
  const htmlTag = /<html\b[^>]*>/i;
  if (htmlTag.test(next)) {
    next = next.replace(htmlTag, (tag) => {
      let updated = tag.replace(/\sdata-ipw-design-system=(?:"[^"]*"|'[^']*')/i, "");
      updated = updated.replace(/\sstyle=("([^"]*)"|'([^']*)')/i, (_attribute, _quoted, doubleValue, singleValue) => {
        const value = String(doubleValue ?? singleValue ?? "");
        const cleaned = value
          .split(";")
          .map((declaration) => declaration.trim())
          .filter((declaration) => declaration && !declaration.toLowerCase().startsWith("--ipw-"))
          .join("; ");
        return cleaned ? ` style="${escapeHtmlAttribute(cleaned)}"` : "";
      });
      return updated.replace(/>$/, ` data-ipw-design-system="${escapeHtmlAttribute(themeId)}">`);
    });
  }

  const existingLink = next.match(/<link\b[^>]*\bhref=(["'])([^"']*design-tokens?\.css)\1[^>]*>\s*/i);
  const href = existingLink?.[2]?.trim() || tokenHref;
  if (existingLink) next = next.replace(existingLink[0], "");
  const link = `<link rel="stylesheet" href="${escapeHtmlAttribute(href)}" data-ipw-design-tokens>`;
  const headEnd = next.search(/<\/head\s*>/i);
  if (headEnd >= 0) next = `${next.slice(0, headEnd)}  ${link}\n${next.slice(headEnd)}`;
  else next = `${link}\n${next}`;
  return next;
}

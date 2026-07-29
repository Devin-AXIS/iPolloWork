export type VideoAiSelectionTarget = {
  file: string;
  locator: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function attributeSelector(name: string, value: string) {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `[${name}="${escaped}"]`;
}

function normalizeProjectFile(value: unknown) {
  const candidate = optionalString(value) || "index.html";
  const normalized = candidate.replace(/\\/g, "/");
  if (
    normalized.startsWith("/")
    || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized)
    || normalized.includes("\0")
    || normalized.includes("?")
    || normalized.includes("#")
  ) {
    return null;
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) return null;
  const file = segments.filter((segment) => segment && segment !== ".").join("/");
  return file || null;
}

export function resolveVideoAiSelectionTarget(value: unknown): VideoAiSelectionTarget | null {
  if (!isRecord(value)) return null;
  const file = normalizeProjectFile(value.file);
  if (!file) return null;

  const hfId = optionalString(value.hfId);
  const id = optionalString(value.id);
  const selector = optionalString(value.selector);
  const locator = hfId
    ? attributeSelector("data-hf-id", hfId)
    : id
      ? attributeSelector("id", id)
      : selector;
  return locator ? { file, locator } : null;
}

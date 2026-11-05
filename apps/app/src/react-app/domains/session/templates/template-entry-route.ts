export type TemplateEntrySurface = "design" | "video";

export type TemplateEntryBinding = {
  surface: TemplateEntrySurface;
  entry: string;
};

type OpenableTarget = {
  kind: string;
  value: string;
};

function normalizePath(path: string) {
  return path.replaceAll("\\", "/");
}

export function designProjectSessionIdFromEntryPath(path: string) {
  const match = /^design\/([^/]+)\/(?:entry|index)\.html$/i.exec(normalizePath(path).trim().replace(/^\.\//, ""));
  return match?.[1] ?? null;
}

export function resolveTemplateEntrySurface(
  target: OpenableTarget,
  binding: TemplateEntryBinding | null | undefined,
): TemplateEntrySurface | null {
  if (target.kind !== "file" || !binding) return null;
  return normalizePath(target.value) === normalizePath(binding.entry) ? binding.surface : null;
}

/**
 * Persisted template metadata normally owns the editor choice. A historical
 * routing bug could, however, replace a Video entry with an ordinary webpage.
 * HyperFrames requires a root composition id, so missing that contract is a
 * reliable signal that the HTML should be recovered in Design instead.
 */
export function resolveTemplateEntryContentSurface(
  binding: TemplateEntryBinding,
  content: string | null | undefined,
): TemplateEntrySurface {
  if (binding.surface !== "video" || content == null) return binding.surface;
  return /\bdata-composition-id\s*=/i.test(content) ? "video" : "design";
}

export async function waitForTemplateEntrySurface(
  target: OpenableTarget,
  binding: Promise<TemplateEntryBinding | null>,
) {
  return resolveTemplateEntrySurface(target, await binding);
}

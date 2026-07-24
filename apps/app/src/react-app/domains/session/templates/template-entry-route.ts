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

export function resolveTemplateEntrySurface(
  target: OpenableTarget,
  binding: TemplateEntryBinding | null | undefined,
): TemplateEntrySurface | null {
  if (target.kind !== "file" || !binding) return null;
  return normalizePath(target.value) === normalizePath(binding.entry) ? binding.surface : null;
}

export async function waitForTemplateEntrySurface(
  target: OpenableTarget,
  binding: Promise<TemplateEntryBinding | null>,
) {
  return resolveTemplateEntrySurface(target, await binding);
}

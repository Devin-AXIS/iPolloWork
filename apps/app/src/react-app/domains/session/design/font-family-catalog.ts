export const FALLBACK_FONT_FAMILIES = [
  "Arial",
  "Courier New",
  "Georgia",
  "Helvetica",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
];

export function fontFamilyOptions(currentFamily: string, catalog: readonly string[]): string[] {
  const current = currentFamily.trim();
  const names = new Map<string, string>();

  for (const candidate of catalog) {
    const name = candidate.trim();
    const key = name.toLocaleLowerCase();
    if (name && key !== current.toLocaleLowerCase() && !names.has(key)) names.set(key, name);
  }

  return [
    ...(current ? [current] : []),
    ...[...names.values()].sort((left, right) => left.localeCompare(right)),
  ];
}

export function filterFontFamilyOptions(options: readonly string[], query: string): string[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return normalizedQuery
    ? options.filter((option) => option.toLocaleLowerCase().includes(normalizedQuery))
    : [...options];
}

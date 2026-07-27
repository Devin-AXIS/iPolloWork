export function displayFontFamily(value: string) {
  const primary = value.split(",", 1)[0]?.trim() || "";
  return primary.replace(/^(["'])(.*)\1$/, "$2");
}

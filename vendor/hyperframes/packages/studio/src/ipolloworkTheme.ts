type StudioTheme = "light" | "dark";

function normalizeTheme(value: unknown): StudioTheme | null {
  return value === "light" || value === "dark" ? value : null;
}

function readThemeFromHash(): StudioTheme | null {
  const query = window.location.hash.split("?")[1] ?? "";
  return normalizeTheme(new URLSearchParams(query).get("ipolloworkTheme"));
}

function applyTheme(theme: StudioTheme) {
  document.documentElement.dataset.ipolloworkTheme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function installIPolloWorkThemeSync() {
  applyTheme(readThemeFromHash() ?? "dark");
  window.addEventListener("message", (event) => {
    const data = event.data as { type?: unknown; theme?: unknown } | null;
    if (!data || data.type !== "ipollowork:studio-theme") return;
    const theme = normalizeTheme(data.theme);
    if (theme) applyTheme(theme);
  });
}

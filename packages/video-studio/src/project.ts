import {
  hyperframesStudioPort,
  videoProjectDirectory,
  videoProjectId,
} from "@ipollowork/types/hyperframes-project";

export const HYPERFRAMES_VERSION = "0.7.60";

export { hyperframesStudioPort, videoProjectDirectory, videoProjectId };

export function hyperframesStudioUrl(
  port = 3_002,
  projectId = "video",
  locale?: string,
  theme?: "light" | "dark",
  reloadToken?: number,
) {
  const params = new URLSearchParams({
    v: "1",
    t: "0",
    tab: "design",
    rc: "1",
    tv: "1",
  });
  if (locale) params.set("locale", locale);
  if (theme) params.set("ipolloworkTheme", theme);
  if (reloadToken != null) params.set("reload", String(reloadToken));
  return `http://localhost:${port}/#project/${encodeURIComponent(projectId)}?${params.toString()}`;
}

export function videoProjectEntryPath(sessionId: string) {
  return `${videoProjectDirectory(sessionId)}/index.html`;
}

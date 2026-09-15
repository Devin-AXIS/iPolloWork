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
  const routeParams = new URLSearchParams({
    v: "1",
    t: "0",
    tab: "design",
    rc: "1",
    tv: "1",
  });
  if (locale) routeParams.set("locale", locale);
  if (theme) routeParams.set("ipolloworkTheme", theme);

  const requestParams = new URLSearchParams();
  if (reloadToken != null) requestParams.set("ipwReload", String(reloadToken));
  const requestQuery = requestParams.size ? `?${requestParams.toString()}` : "";

  return `http://localhost:${port}/${requestQuery}#project/${encodeURIComponent(projectId)}?${routeParams.toString()}`;
}

export function videoProjectEntryPath(sessionId: string) {
  return `${videoProjectDirectory(sessionId)}/index.html`;
}

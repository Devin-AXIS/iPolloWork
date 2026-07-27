export type DenDesktopAuthScheme = "ipollowork" | "ipollowork-dev";

export function resolveDenDesktopAuthScheme(isDevelopment: boolean): DenDesktopAuthScheme {
  return isDevelopment ? "ipollowork-dev" : "ipollowork";
}

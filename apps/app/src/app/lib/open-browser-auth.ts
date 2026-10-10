import { openDesktopAuthUrl } from "./desktop";
import { isDesktopRuntime } from "../utils";

export async function tryOpenBrowserAuthUrl(url: string): Promise<boolean> {
  if (isDesktopRuntime()) {
    try {
      await openDesktopAuthUrl(url);
      return true;
    } catch (error) {
      console.error("[den-auth] failed to open browser:", error);
      return false;
    }
  }

  return window.open(url, "_blank") !== null;
}

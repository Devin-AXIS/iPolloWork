import "vite/client";

declare global {
  interface Window {
    __IPOLLOWORK_VIDEO_STUDIO_TOKEN__?: string;
    __IPOLLOWORK_ELECTRON__?: {
      invokeDesktop?: (command: string, ...args: unknown[]) => Promise<unknown>;
    };
  }
}

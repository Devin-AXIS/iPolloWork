import { useEffect, useRef, type RefObject } from "react";
import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { getReactQueryClient } from "@/react-app/infra/query-client";
import { createWorkspaceFileOpenTarget } from "@/react-app/domains/session/artifacts/open-target";
import type { WorkspaceImageLoader, WorkspaceThumbnailLoader } from "@/lib/target-provider";

export function loadArtifactThumbnail(client: iPolloWorkServerClient, workspaceId: string, path: string) {
  return getReactQueryClient().fetchQuery({
    queryKey: ["artifact-thumbnail", client.baseUrl, workspaceId, path], staleTime: 60_000, gcTime: 300_000,
    retry: 2,
    queryFn: async () => {
      const resolved = await client.resolveArtifacts(workspaceId, [createWorkspaceFileOpenTarget({ path })]);
      const target = resolved.items.find(item => item.kind === "file" && item.exists);
      if (!target) throw new Error("Thumbnail unavailable");
      const result = await client.downloadWorkspaceThumbnail(workspaceId, target.value);
      return { blob: new Blob([result.data], { type: "image/webp" }), detail: result.detail ? decodeURIComponent(result.detail) : "" };
    },
  });
}

export function createMarkdownImageLoader(loadImage: WorkspaceImageLoader) {
  const requests = new Map<string, Promise<string>>();
  const urls = new Set<string>();
  let disposed = false;
  return {
    load(path: string) {
      if (disposed) return Promise.reject(new Error("Image preview disposed"));
      let request = requests.get(path);
      if (!request) {
        request = loadImage(path).then((blob) => {
          if (disposed) throw new Error("Image preview disposed");
          const url = URL.createObjectURL(blob);
          urls.add(url);
          return url;
        });
        // Deduplicate images and streamed re-renders, including failed requests.
        requests.set(path, request);
      }
      return request;
    },
    dispose() {
      disposed = true;
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
      requests.clear();
    },
  };
}

// Both Markdown HTML and React file cards keep the same fallback icon until decoding succeeds.
export function useArtifactThumbnails(rootRef: RefObject<HTMLElement | null>, loadThumbnail?: WorkspaceThumbnailLoader) {
  const detailsRef = useRef(new Map<string, string>());
  const loaderRef = useRef<ReturnType<typeof createMarkdownImageLoader> | null>(null);
  useEffect(() => {
    detailsRef.current.clear();
    const loader = loadThumbnail ? createMarkdownImageLoader(async path => {
      const result = await loadThumbnail(path);
      detailsRef.current.set(path, result.detail);
      return result.blob;
    }) : null;
    loaderRef.current = loader;
    const root = rootRef.current;
    return () => {
      loaderRef.current = null; loader?.dispose();
      root?.querySelectorAll(".artifact-thumbnail, .artifact-thumbnail-play").forEach(image => image.remove());
    };
  }, [loadThumbnail]);
  useEffect(() => {
    const root = rootRef.current;
    const loader = loaderRef.current;
    if (!root || !loader) return;
    let disposed = false;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const icon = entry.target;
        observer.unobserve(icon);
        const path = icon.getAttribute("data-artifact-thumbnail");
        if (!path || icon.querySelector("img")) continue;
        void loader.load(path).then(url => {
          if (disposed || !root.contains(icon) || icon.querySelector("img")) return;
          const image = new Image();
          image.alt = ""; image.className = "artifact-thumbnail";
          image.onload = () => {
            if (disposed || !root.contains(icon) || icon.querySelector("img")) return;
            icon.append(image);
            const description = icon.closest(".chat-output-card")?.querySelector(".chat-output-description");
            const detail = detailsRef.current.get(path);
            if (description && detail) description.textContent = `${description.textContent?.split(" · ")[0]} · ${detail}`;
            if (/\.(mp4|mov|webm)$/i.test(path)) {
              const badge = document.createElementNS("http://www.w3.org/2000/svg", "svg");
              badge.setAttribute("viewBox", "0 0 24 24"); badge.setAttribute("class", "artifact-thumbnail-play");
              badge.setAttribute("aria-hidden", "true");
              const triangle = document.createElementNS("http://www.w3.org/2000/svg", "path");
              triangle.setAttribute("d", "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"); badge.append(triangle); icon.append(badge);
            }
          };
          image.src = url;
        }).catch(() => undefined);
      }
    }, { rootMargin: "80px" });
    root.querySelectorAll("[data-artifact-thumbnail]").forEach(icon => observer.observe(icon));
    return () => { disposed = true; observer.disconnect(); };
  });
}

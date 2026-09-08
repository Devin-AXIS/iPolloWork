import type { DomEditSelection } from "../components/editor/domEditing";
import {
  isThemeBackgroundSurface,
  resolveEditableBackgroundImage,
} from "../components/editor/propertyPanelFill";
import { applyPatchByTarget, readTagSnippetByTarget, type PatchTarget } from "./sourcePatcher";
import { resolveTimelineAssetSrc } from "./timelineAssetDrop";
import { safeVideoImagePath } from "@ipollowork/types/video-image-workbench";

export type EditableVideoImage = {
  sourcePath: string;
  previewUrl: string;
  kind: "image" | "background";
  background: string;
  themeBackground: boolean;
};

// Studio's upload API uses OS-native separators, unlike the host bridge contract.
export function uploadedVideoImagePath(result: unknown): string | null {
  const path = result && typeof result === "object" && "files" in result && Array.isArray(result.files)
    ? result.files[0] : null;
  return safeVideoImagePath(typeof path === "string" ? path.replaceAll("\\", "/") : path);
}

// Only authored raster assets: a video poster/frame, canvas, SVG, remote URL,
// responsive picture or multi-image background cannot be edited unambiguously.
export function resolveEditableVideoImage(
  selection: DomEditSelection,
  projectId: string,
): EditableVideoImage | null {
  const { element } = selection;
  if ((!selection.hfId && !selection.id) || selection.isInsideLockedComposition) return null;
  if (element.closest("video,canvas,svg,picture") || element.hasAttribute("srcset")) return null;
  const kind = element.tagName.toLowerCase() === "img" ? "image" : "background";
  const background =
    kind === "background" ? resolveEditableBackgroundImage(element, selection.computedStyles) : "";
  const urls = Array.from(background.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi));
  const source =
    kind === "image" ? element.getAttribute("src") : urls.length === 1 ? urls[0][1] : null;
  if (!source || /^(data|blob):/i.test(source)) return null;
  try {
    const base = new URL(element.baseURI);
    const url = new URL(source, base);
    const prefix = `/api/projects/${encodeURIComponent(projectId)}/preview/`;
    if (url.origin !== base.origin || !url.pathname.startsWith(prefix)) return null;
    const sourcePath = safeVideoImagePath(decodeURIComponent(url.pathname.slice(prefix.length)));
    if (!sourcePath) return null;
    return {
      sourcePath,
      previewUrl: url.href,
      kind,
      background,
      themeBackground:
        kind === "background" &&
        (isThemeBackgroundSurface(element) ||
          Boolean(element.style.getPropertyValue("--ipw-bg-image"))),
    };
  } catch {
    return null;
  }
}

export type VideoImageBinding = EditableVideoImage & {
  target: PatchTarget;
  sourceFile: string;
  originalTag: string;
};

export function captureVideoImageBinding(
  selection: DomEditSelection,
  image: EditableVideoImage,
  html: string,
): VideoImageBinding {
  const target = selection.hfId ? { hfId: selection.hfId } : { id: selection.id };
  const originalTag = readTagSnippetByTarget(html, target);
  if (!originalTag) throw new Error("The selected image no longer exists. Select it again.");
  return { ...image, target, sourceFile: selection.sourceFile, originalTag };
}

export function assertVideoImageBinding(html: string, binding: VideoImageBinding) {
  if (readTagSnippetByTarget(html, binding.target) !== binding.originalTag) {
    throw new Error(
      "The selected image changed while editing. Select it again before replacing it.",
    );
  }
}

export function replaceBoundVideoImage(
  html: string,
  binding: VideoImageBinding,
  assetPath: string,
): string {
  assertVideoImageBinding(html, binding);
  if (!safeVideoImagePath(assetPath)) throw new Error("Invalid edited image path.");
  const src = resolveTimelineAssetSrc(binding.sourceFile, assetPath);
  if (binding.kind === "image") {
    return applyPatchByTarget(html, binding.target, {
      type: "html-attribute",
      property: "src",
      value: src,
    });
  }
  const value = binding.background.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/i, `url("${src}")`);
  let next = applyPatchByTarget(html, binding.target, {
    type: "inline-style",
    property: "background-image",
    value,
  });
  if (binding.themeBackground)
    next = applyPatchByTarget(next, binding.target, {
      type: "inline-style",
      property: "--ipw-bg-image",
      value,
    });
  return next;
}

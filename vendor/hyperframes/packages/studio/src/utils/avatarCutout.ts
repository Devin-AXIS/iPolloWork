import {
  applyPatchByTarget,
  findTagByTarget,
  readAttributeByTarget,
  type PatchTarget,
} from "./sourcePatcher";

/** Keep the original clip (and its audio/animation) as the editable source. */
export function applyAvatarCutout(
  html: string,
  target: PatchTarget,
  source: string,
  output: string,
  layers: Array<{ target: PatchTarget; zIndex: number }>,
): string {
  const match = findTagByTarget(html, target);
  if (!match || !/^<video\b/i.test(match.tag)) throw new Error("找不到原视频，请重新选择后重试。");
  if (readAttributeByTarget(html, target, "data-avatar-cutout")) return html;
  const foregroundId = `avatar-cutout-${crypto.randomUUID()}`;
  const doc = new DOMParser().parseFromString(`${match.tag}></video>`, "text/html");
  const foreground = doc.querySelector("video");
  if (!foreground) throw new Error("无法读取视频图层。");
  if (foreground.getAttribute("src") !== source)
    throw new Error("视频素材已变化，请重新选择后抠图。");
  const sourceId = foreground.id || `avatar-source-${crypto.randomUUID()}`;
  const priorZ = foreground.style.zIndex;
  foreground.id = foregroundId;
  foreground.removeAttribute("data-hf-id");
  foreground.removeAttribute("data-hf-color-grading");
  foreground.setAttribute("src", output);
  foreground.setAttribute("data-avatar-source", sourceId);
  foreground.setAttribute("data-volume", "0");
  foreground.setAttribute("data-has-audio", "false");
  foreground.setAttribute("muted", "");
  foreground.setAttribute("aria-hidden", "true");
  foreground.setAttribute("data-label", "人物前景 · 智能抠图");
  // Overlapping videos in one track are mutually exclusive in preview.
  const tracks = new DOMParser()
    .parseFromString(html, "text/html")
    .querySelectorAll("[data-track-index]");
  foreground.setAttribute(
    "data-track-index",
    String(
      Math.max(
        0,
        ...Array.from(tracks, (element) => Number(element.getAttribute("data-track-index")) || 0),
      ) + 1,
    ),
  );
  foreground.style.pointerEvents = "none";
  foreground.style.zIndex = String(Math.max(1, ...layers.map((layer) => layer.zIndex)) + 1);
  let result = html;
  for (const layer of layers) {
    if (!findTagByTarget(result, layer.target))
      throw new Error("无法保存图层顺序，请重新打开视频后重试。");
    result = applyPatchByTarget(result, layer.target, {
      type: "inline-style",
      property: "z-index",
      value: String(layer.zIndex),
    });
  }
  for (const [property, value] of [
    ["data-avatar-cutout", foregroundId],
    ["data-avatar-prior-z", priorZ],
    ["id", sourceId],
  ]) {
    result = applyPatchByTarget(result, target, { type: "html-attribute", property, value });
  }
  const updated = findTagByTarget(result, { id: sourceId });
  if (!updated) throw new Error("无法保存人物图层。");
  const close = result.indexOf("</video>", updated.end);
  if (close < 0) throw new Error("原视频标签不完整。");
  const at = close + "</video>".length;
  return result.slice(0, at) + "\n" + foreground.outerHTML + result.slice(at);
}

export function removeAvatarCutout(html: string, target: PatchTarget): string {
  const id = readAttributeByTarget(html, target, "data-avatar-cutout");
  if (!id) return html;
  let result = html;
  const foreground = findTagByTarget(result, { id });
  if (foreground) {
    const end = result.indexOf("</video>", foreground.end);
    if (end < 0) throw new Error("人物前景标签不完整。");
    result = result.slice(0, foreground.start) + result.slice(end + 8);
  }
  result = applyPatchByTarget(result, target, {
    type: "inline-style",
    property: "z-index",
    value: readAttributeByTarget(result, target, "data-avatar-prior-z") || null,
  });
  for (const property of ["data-avatar-cutout", "data-avatar-prior-z"]) {
    result = applyPatchByTarget(result, target, { type: "html-attribute", property, value: null });
  }
  return result;
}

export function projectMediaPath(sourceFile: string, src: string): string {
  const base = new URL(sourceFile, "https://project.local/");
  const url = new URL(src, base);
  if (url.origin !== base.origin || /^(?:[a-z]+:|\/)/i.test(src))
    throw new Error("智能抠图需要项目中的本地视频素材。");
  return decodeURIComponent(url.pathname.slice(1));
}

export function relativeMediaPath(sourceFile: string, output: string): string {
  const from = sourceFile.split("/").slice(0, -1);
  const to = output.split("/");
  while (from.length && to.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return [...from.map(() => ".."), ...to].join("/");
}

/** Store the transparent foreground as an internal layer, not a second material. */
export function avatarCutoutOutputPath(inputPath: string): string {
  const filename = inputPath.split("/").pop() ?? "avatar";
  const stem = filename.replace(/\.[^.]+$/, "");
  const slug = stem
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "avatar";
  return `renders/avatar-cutouts/${slug}-cutout.webm`;
}

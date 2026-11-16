/** Stable catalog categories shared by server validation and its administration UI. */
export const serviceCategories = [
  "language",
  "image",
  "video",
  "audio",
  "embedding",
  "tool",
] as const;
export type ServiceCategory = (typeof serviceCategories)[number];
export const categoryLabels: Record<ServiceCategory, string> = {
  language: "语言模型",
  image: "图像模型",
  video: "视频模型",
  audio: "语音模型",
  embedding: "向量模型",
  tool: "工具服务",
};
/** Classify older records by declared capabilities, never by a model-name guess.
 * @param category Explicit operator classification, when saved.
 * @param capabilities Declared service operations; chat takes precedence for multimodal language models.
 * @returns The catalog category used by clients and authorization lists.
 */
export function serviceCategory(
  category: ServiceCategory | undefined,
  capabilities: readonly string[],
): ServiceCategory {
  if (category) return category;
  if (capabilities.includes("chat")) return "language";
  if (capabilities.includes("image")) return "image";
  if (capabilities.includes("video")) return "video";
  if (
    capabilities.some((value) =>
      ["speech", "audio", "transcription"].includes(value),
    )
  )
    return "audio";
  if (capabilities.includes("embedding")) return "embedding";
  if (capabilities.includes("tool")) return "tool";
  return "language";
}

/** Catalog category IDs are supplied by the account service and retained by every consumer. */
import type {ServiceCategory} from './services.ts';
export type {ServiceCategory} from './services.ts';
export const serviceCategories = [
  "language",
  "image",
  "video",
  "audio",
  "embedding",
  "tool",
] as const;
const labels = {
  en: {
    language: "Language models",
    image: "Image models",
    video: "Video models",
    audio: "Speech models",
    embedding: "Embedding models",
    tool: "Tools",
  },
  zh: {
    language: "语言模型",
    image: "图像模型",
    video: "视频模型",
    audio: "语音模型",
    embedding: "向量模型",
    tool: "工具",
  },
};
/** Translate one catalog category.
 * @param category Server-supplied category ID.
 * @param language Active client language.
 * @returns A visible category label.
 */
export function categoryLabel(
  category: ServiceCategory,
  language: string,
): string {
  return labels[language === "zh" ? "zh" : "en"][category];
}

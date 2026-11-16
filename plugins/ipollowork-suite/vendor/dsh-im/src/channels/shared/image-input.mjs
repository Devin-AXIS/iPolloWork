import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import {
  detectedImageMediaType, ImagePromptError, imageStorageName, loadedImage, imageDownloadLimitMessage,
} from './image-prompt.mjs';
import { t } from './i18n.mjs';

const MAX_INPUT_PIXELS = 64_000_000;
const COMPRESSION_STEPS = [[2048, 80], [1536, 70], [1024, 60]];
let sharpPromise;
async function loadSharp() {
  sharpPromise ??= import('sharp').then((module) => module.default).catch(() => null);
  return sharpPromise;
}

export const IMAGE_ORIGINALS_PROMPT = '图片原文件已保存到工作区，文件清单中的图片序号与本条消息一致。图片内容块可能经过缩放或压缩；需要查看细节时可用工具读取原文件。';
export const IMAGE_INPUT_FALLBACK_PROMPT = '部分图片未直接提供给模型，图片序号：{indexes}。原文件已保存，请使用可用工具读取或分析；不要假设自己已看到这些图片。';
export const IMAGE_HOST_LIMIT_FALLBACK_PROMPT = '宿主拒绝了本次图片输入。原图已保存到工作区，请根据文件清单使用可用工具读取或分析，不要假设自己已看到图片。';

/** Keep provider loaders intact; stage and validate each original once. */
export function inboundImagesAsFiles(images, limits) {
  if (images.length > limits.maxImages) {
    throw new ImagePromptError('too-many-images', 'Too many inbound images',
      t('一次最多只能处理 {maxImages} 张图片。', { maxImages: limits.maxImages }));
  }
  const tooLarge = () => new ImagePromptError('image-too-large',
    `Image exceeds ${limits.maxDownloadBytes} bytes`, imageDownloadLimitMessage(limits.maxDownloadBytes));
  // Check declared sizes before any download starts, including later images.
  for (const source of images) {
    if (Number.isFinite(source?.size) && source.size > limits.maxDownloadBytes) throw tooLarge();
  }
  return images.map((source, index) => ({
    async load({ signal } = {}) {
      signal?.throwIfAborted();
      let value;
      try {
        value = source.data === undefined
          ? await source.load?.({ signal, maxBytes: limits.maxDownloadBytes }) : source.data;
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        if (error?.code === 'image-too-large') throw tooLarge();
        if (error instanceof ImagePromptError || ['AbortError', 'TimeoutError'].includes(error?.name)) throw error;
        throw new ImagePromptError('image-download-failed', 'Unable to download image',
          t('图片下载失败，请重新发送后再试。'), { cause: error });
      }
      signal?.throwIfAborted();
      const loaded = loadedImage(value);
      if (!loaded?.data.length) throw new ImagePromptError('invalid-image-data', 'Empty image',
        t('未能读取图片内容，请重新发送。'));
      if (loaded.data.length > limits.maxDownloadBytes) throw tooLarge();
      const mediaType = detectedImageMediaType(loaded.data);
      if (!mediaType) throw new ImagePromptError('unsupported-image-type', 'Unsupported image',
        t('暂不支持该图片格式，请发送 JPEG、PNG、WebP 或 GIF 图片。'));
      return { data: loaded.data, mediaType,
        name: `${index + 1}-${imageStorageName(loaded.name ?? source.name, mediaType, index)}` };
    },
  }));
}

/** A missing optional codec still permits small native images and file delivery. */
export async function modelImageFromOriginal(data, mediaType, maxBytes, {
  signal, sharpLoader = loadSharp,
} = {}) {
  signal?.throwIfAborted();
  if (maxBytes <= 0) return null;
  const sharp = await sharpLoader();
  signal?.throwIfAborted();
  if (!sharp) return data.length <= maxBytes ? { data, mediaType } : null;
  try {
    const metadata = await sharp(data, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    signal?.throwIfAborted();
    if (metadata.width * metadata.height > MAX_INPUT_PIXELS) return null;
    if ((metadata.pages ?? 1) > 1 || mediaType === 'image/gif') {
      return data.length <= maxBytes ? { data, mediaType } : null;
    }
    if (data.length <= maxBytes && metadata.width <= 2048 && metadata.height <= 2048) {
      return { data, mediaType };
    }
    for (const [side, quality] of COMPRESSION_STEPS) {
      signal?.throwIfAborted();
      const operation = sharp(data, { limitInputPixels: MAX_INPUT_PIXELS }).rotate()
        .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true });
      const output = metadata.hasAlpha
        ? await operation.png({ compressionLevel: 9 }).toBuffer()
        : await operation.jpeg({ quality }).toBuffer();
      signal?.throwIfAborted();
      if (output.length <= maxBytes) return { data: output,
        mediaType: metadata.hasAlpha ? 'image/png' : 'image/jpeg' };
    }
  } catch (error) {
    signal?.throwIfAborted();
    // A codec failure cannot discard an original already saved for tools.
  }
  return null;
}

export async function imageContentFromStaged(staged, limits, { signal, sharpLoader } = {}) {
  const content = [];
  const fileOnly = [];
  let remaining = limits.maxTotalImageBytes;
  for (const [index, file] of staged.files.entries()) {
    signal?.throwIfAborted();
    // Staging owns both the directory and basename; never read a user-supplied path.
    const data = await readFile(join(staged.directory, basename(file.path)), { signal });
    const result = await modelImageFromOriginal(data, file.mediaType,
      Math.min(limits.maxImageBytes, remaining), { signal, sharpLoader });
    if (!result) { fileOnly.push(index + 1); continue; }
    remaining -= result.data.length;
    content.push({ type: 'text', text: t('图片 {index}（原图文件：{name}）', { index: index + 1, name: file.name }) },
      { type: 'image', mediaType: result.mediaType, data: result.data.toString('base64'),
        name: imageStorageName(file.name.replace(/\.[^.]+$/, ''), result.mediaType, index) });
  }
  content.push({ type: 'text', text: t(IMAGE_ORIGINALS_PROMPT) });
  if (fileOnly.length) content.push({ type: 'text',
    text: t(IMAGE_INPUT_FALLBACK_PROMPT, { indexes: fileOnly.join(', ') }) });
  return content;
}

export function isImageAdmissionRejection(error) {
  return ['attachment-error', 'session/attachment-invalid'].includes(error?.code)
    && ['MODEL_DOES_NOT_SUPPORT_IMAGES', 'IMAGE_TOO_LARGE', 'IMAGES_TOO_LARGE',
      'IMAGE_TOO_MANY_PIXELS', 'TOO_MANY_IMAGES'].includes(error?.details?.reason);
}

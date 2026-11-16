import { t } from './i18n.mjs';

const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_IMAGES = 20;
const DEFAULT_MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;

export const DEFAULT_IMAGE_PROMPT = '请分析这张图片。';

/**
 * Model-facing guidance appended when the Host refuses image input for the
 * current model and the same images are re-delivered as workspace files.
 */
export const IMAGE_FILE_FALLBACK_PROMPT = '当前会话模型不支持直接接收图片输入。用户发送的图片已作为文件保存到工作区（见下方文件清单）。请使用可用工具分析这些图片文件后回答，例如 run_code 或 pwsh 读取字节、解析元数据、调用图像处理或 OCR 库；不要假设自己能直接看到图片内容。';

export function imageDownloadLimitMessage(maxBytes) {
  return t('图片超过原图接收上限 {maxMb} MB，请压缩后重试，或在通用设置的附件中调整上限。',
    { maxMb: Math.round(maxBytes / (1024 * 1024) * 100) / 100 });
}

export class ImagePromptError extends Error {
  constructor(code, message, userMessage, options = {}) {
    super(message, options);
    this.name = 'ImagePromptError';
    this.code = code;
    this.userMessage = userMessage;
  }
}

const HOST_ATTACHMENT_USER_MESSAGES = Object.freeze({
  MODEL_DOES_NOT_SUPPORT_IMAGES:
    '当前模型不支持图片，请用 /models 查看可用模型，再用 /model <序号> 切换后重发。',
  IMAGE_TOO_LARGE: '图片超过宿主允许的大小，请压缩后重试。',
  IMAGE_TOO_MANY_PIXELS: '图片分辨率过高，请压缩后重试。',
  INVALID_IMAGE: '图片内容无效或格式不受支持，请重新发送。',
  INVALID_IMAGE_BASE64: '未能读取图片内容，请重新发送。',
  IMAGE_TYPE_MISMATCH: '图片格式与实际内容不一致，请重新发送。',
  TOO_MANY_IMAGES: '一次发送的图片数量超过宿主限制，请减少后重试。',
  IMAGES_TOO_LARGE: '图片总大小超过宿主限制，请减少图片或压缩后重试。',
});

function requestSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function cancelResponseBody(response) {
  try {
    await response?.body?.cancel?.();
  } catch {
    // The original download error is more useful than a best-effort cleanup failure.
  }
}

export async function fetchImageBuffer(url, {
  fetchImpl = fetch,
  headers,
  signal,
  maxBytes = DEFAULT_MAX_IMAGE_BYTES,
  timeoutMs = 15_000,
  allowedHosts,
} = {}) {
  const target = new URL(url);
  if (target.protocol !== 'https:') throw new Error('Image download URL must use HTTPS');
  if (Array.isArray(allowedHosts) && !allowedHosts.some((rule) => (
    typeof rule === 'string'
    && (target.hostname === rule
      || (rule.startsWith('.')
        && (target.hostname === rule.slice(1) || target.hostname.endsWith(rule))))
  ))) {
    throw new Error('Image download URL is not hosted by the messaging platform');
  }
  const response = await fetchImpl(target, {
    method: 'GET',
    headers,
    signal: requestSignal(signal, timeoutMs),
    redirect: 'manual',
  });
  if (Number.isInteger(response?.status) && response.status >= 300 && response.status < 400) {
    await cancelResponseBody(response);
    throw new ImagePromptError(
      'image-redirect-blocked',
      `Image download redirect was blocked (HTTP ${response.status})`,
      t('图片下载地址发生了重定向，暂时无法读取。'),
    );
  }
  if (!response?.ok) {
    await cancelResponseBody(response);
    throw new ImagePromptError(
      'image-http-error',
      `Image download failed with HTTP ${response?.status ?? 'unknown'}`,
      t('图片下载失败（HTTP {status}），请重新发送后再试。', { status: response?.status ?? 'unknown' }),
    );
  }
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await cancelResponseBody(response);
    throw new ImagePromptError(
      'image-too-large',
      `Image response declares ${declaredLength} bytes; the limit is ${maxBytes}`,
      imageDownloadLimitMessage(maxBytes),
    );
  }

  if (response.body?.[Symbol.asyncIterator]) {
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      const data = Buffer.from(chunk);
      size += data.length;
      if (size > maxBytes) {
        await response.body.cancel?.().catch?.(() => undefined);
        throw new ImagePromptError(
          'image-too-large',
          `Image response exceeded ${maxBytes} bytes`,
          imageDownloadLimitMessage(maxBytes),
        );
      }
      chunks.push(data);
    }
    return Buffer.concat(chunks, size);
  }

  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > maxBytes) {
    throw new ImagePromptError(
      'image-too-large',
      `Image response contains ${data.length} bytes; the limit is ${maxBytes}`,
      imageDownloadLimitMessage(maxBytes),
    );
  }
  return data;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function imageSources(message) {
  return Array.isArray(message?.images) ? message.images.filter(Boolean) : [];
}

function safeName(value) {
  if (typeof value !== 'string') return undefined;
  const name = value
    .replaceAll('\\', '/')
    .split('/')
    .at(-1)
    ?.replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 255);
  return name || undefined;
}

export function detectedImageMediaType(data) {
  if (data.length >= 8
    && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
    && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) {
    return 'image/png';
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (data.length >= 6) {
    const signature = data.subarray(0, 6).toString('ascii');
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif';
  }
  if (data.length >= 12
    && data.subarray(0, 4).toString('ascii') === 'RIFF'
    && data.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export function loadedImage(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { data: Buffer.from(value) };
  }
  const raw = value?.data ?? value?.buffer;
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    return {
      data: Buffer.from(raw),
      name: value?.name ?? value?.filename,
    };
  }
  return null;
}

export function hasInboundImages(message) {
  return imageSources(message).length > 0;
}

export function hasInboundPrompt(message) {
  return Boolean(cleanText(message?.content)) || hasInboundImages(message);
}

export async function promptContentForMessage(message, {
  signal,
  deferImages = false,
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
  maxImages = DEFAULT_MAX_IMAGES,
  maxTotalImageBytes = DEFAULT_MAX_TOTAL_IMAGE_BYTES,
} = {}) {
  const sources = imageSources(message);
  if (!deferImages && sources.length > maxImages) {
    throw new ImagePromptError(
      'too-many-images',
      `Image message contains ${sources.length} images; the limit is ${maxImages}`,
      t('一次最多只能处理 {maxImages} 张图片。', { maxImages }),
    );
  }

  const text = cleanText(message?.content);
  const content = [];
  let totalImageBytes = 0;
  if (text) content.push({ type: 'text', text });
  else if (sources.length > 0) content.push({ type: 'text', text: t(DEFAULT_IMAGE_PROMPT) });

  if (deferImages) return content;

  for (const [index, source] of sources.entries()) {
    signal?.throwIfAborted();
    if (Number.isFinite(source?.size) && source.size > maxImageBytes) {
      throw new ImagePromptError(
        'image-too-large',
        `Image ${index + 1} declares ${source.size} bytes; the limit is ${maxImageBytes}`,
        t('图片超过 5 MB，请压缩后重试。'),
      );
    }
    if (Number.isFinite(source?.size) && totalImageBytes + source.size > maxTotalImageBytes) {
      throw new ImagePromptError(
        'images-too-large',
        `Images declare more than ${maxTotalImageBytes} bytes in total`,
        t('一次发送的图片总大小过大，请减少图片数量或压缩后重试。'),
      );
    }

    let result;
    try {
      result = source?.data === undefined
        ? await source?.load?.({ signal, maxBytes: maxImageBytes })
        : source.data;
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
      if (error instanceof ImagePromptError) throw error;
      throw new ImagePromptError(
        'image-download-failed',
        `Unable to download image ${index + 1}: ${error?.message ?? String(error)}`,
        t('图片下载失败，请重新发送后再试。'),
        { cause: error },
      );
    }
    const loaded = loadedImage(result);
    if (!loaded?.data.length) {
      throw new ImagePromptError(
        'invalid-image-data',
        `Image ${index + 1} returned no data`,
        t('未能读取图片内容，请重新发送。'),
      );
    }
    if (loaded.data.length > maxImageBytes) {
      throw new ImagePromptError(
        'image-too-large',
        `Image ${index + 1} contains ${loaded.data.length} bytes; the limit is ${maxImageBytes}`,
        t('图片超过 5 MB，请压缩后重试。'),
      );
    }
    if (totalImageBytes + loaded.data.length > maxTotalImageBytes) {
      throw new ImagePromptError(
        'images-too-large',
        `Images contain more than ${maxTotalImageBytes} bytes in total`,
        t('一次发送的图片总大小过大，请减少图片数量或压缩后重试。'),
      );
    }
    totalImageBytes += loaded.data.length;
    const mediaType = detectedImageMediaType(loaded.data);
    if (!mediaType) {
      throw new ImagePromptError(
        'unsupported-image-type',
        `Image ${index + 1} is not JPEG, PNG, GIF, or WebP`,
        t('暂不支持该图片格式，请发送 JPEG、PNG、WebP 或 GIF 图片。'),
      );
    }
    content.push({
      type: 'image',
      mediaType,
      data: loaded.data.toString('base64'),
      ...(safeName(loaded.name ?? source?.name) ? { name: safeName(loaded.name ?? source?.name) } : {}),
    });
  }
  return content;
}

/** Return only allowlisted, user-safe image failure details. */
export function imagePromptDiagnostic(error) {
  if (error instanceof ImagePromptError) {
    return {
      code: 'image-prompt-error',
      reason: error.code,
      userMessage: error.userMessage,
    };
  }
  if (error?.code !== 'attachment-error' || typeof error?.details?.reason !== 'string') {
    return null;
  }
  const reason = error.details.reason;
  const userMessage = Object.hasOwn(HOST_ATTACHMENT_USER_MESSAGES, reason)
    ? t(HOST_ATTACHMENT_USER_MESSAGES[reason])
    : null;
  return userMessage ? { code: 'attachment-error', reason, userMessage } : null;
}

export function imagePromptUserMessage(error) {
  return imagePromptDiagnostic(error)?.userMessage ?? null;
}

const IMAGE_FILE_EXTENSIONS = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
]);

const IMAGE_EXTENSION_PATTERN = /\.(?:png|jpe?g|gif|webp)$/i;

export function imageStorageName(name, mediaType, index) {
  const extension = IMAGE_FILE_EXTENSIONS.get(mediaType) ?? '.img';
  const cleaned = safeName(name);
  if (cleaned && IMAGE_EXTENSION_PATTERN.test(cleaned)) return cleaned;
  return `${cleaned ?? `image-${index + 1}`}${extension}`;
}

/**
 * Convert already-admitted image content blocks into inbound file sources so
 * the same bytes can reach a non-vision model as workspace files — the path
 * ordinary uploads such as zip archives already take.
 */
export function imageFileSourcesFromContent(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((part) => part?.type === 'image')
    .map((part, index) => ({
      name: imageStorageName(part.name, part.mediaType, index),
      ...(typeof part.mediaType === 'string' && part.mediaType.trim()
        ? { mediaType: part.mediaType.trim() }
        : {}),
      data: Buffer.from(typeof part.data === 'string' ? part.data : '', 'base64'),
    }));
}

/** Return the same content with every image block removed. */
export function contentWithoutImages(content) {
  return Array.isArray(content) ? content.filter((part) => part?.type !== 'image') : content;
}

/** Whether an error is the Host rejecting image input for a non-vision model. */
export function isModelImageRejection(error) {
  return error?.code === 'attachment-error'
    && error?.details?.reason === 'MODEL_DOES_NOT_SUPPORT_IMAGES';
}

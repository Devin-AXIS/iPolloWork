export const IMAGE_MEGABYTE = 1024 * 1024;

export const DEFAULT_IMAGE_INPUT_SETTINGS = Object.freeze({
  maxDownloadMb: 30,
  maxImageMb: 5,
  maxTotalMb: 20,
  maxImages: 20,
});

/** Shared by the settings form and Host; reject incomplete or unsafe values. */
export function normalizeImageInputSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const key of Object.keys(DEFAULT_IMAGE_INPUT_SETTINGS)) {
    const input = value[key];
    const number = typeof input === 'string' && /^\d+$/.test(input.trim())
      ? Number(input.trim()) : input;
    if (!Number.isSafeInteger(number) || number < 1
      || !Number.isSafeInteger(number * IMAGE_MEGABYTE)) return null;
    result[key] = number;
  }
  if (result.maxDownloadMb < result.maxImageMb || result.maxTotalMb < result.maxImageMb) return null;
  return Object.freeze(result);
}

export function imageInputLimits(settings = DEFAULT_IMAGE_INPUT_SETTINGS) {
  const normalized = normalizeImageInputSettings(settings);
  if (!normalized) throw new TypeError('Invalid image input settings');
  return Object.freeze({
    maxDownloadBytes: normalized.maxDownloadMb * IMAGE_MEGABYTE,
    maxImageBytes: normalized.maxImageMb * IMAGE_MEGABYTE,
    maxTotalImageBytes: normalized.maxTotalMb * IMAGE_MEGABYTE,
    maxImages: normalized.maxImages,
  });
}

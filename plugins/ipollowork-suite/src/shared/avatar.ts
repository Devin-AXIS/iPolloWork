/** Raster-avatar limits shared by the upload UI and durable-data validator. */
export const AVATAR_SIZE = 256
export const AVATAR_MAX_BYTES = 128 * 1024
export const AVATAR_MAX_UPLOAD_BYTES = 5 * 1024 * 1024
export const AVATAR_MAX_DATA_URL_LENGTH = Math.ceil(AVATAR_MAX_BYTES / 3) * 4 + 32

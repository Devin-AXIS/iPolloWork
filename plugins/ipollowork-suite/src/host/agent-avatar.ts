/** Validate self-contained raster avatars before native storage accepts them. */
import { imageSize } from 'image-size'
import { AVATAR_MAX_BYTES, AVATAR_MAX_DATA_URL_LENGTH, AVATAR_SIZE } from '../shared/avatar.ts'

/** Accept an empty avatar or bounded PNG/JPEG/WebP bytes with square dimensions.
 * @param value Encoded image supplied through the management API or durable storage.
 * @returns Whether the image format, byte count and dimensions are supported.
 */
export function validAvatar(value: string): boolean {
  if (value === '') return true
  if (value.length > AVATAR_MAX_DATA_URL_LENGTH) return false
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match) return false
  const [, mime, encoded] = match
  if (!encoded) return false
  const bytes = Buffer.from(encoded, 'base64')
  if (!bytes.length || bytes.length > AVATAR_MAX_BYTES || bytes.toString('base64') !== encoded) return false
  try {
    const image = imageSize(bytes)
    const type = image.type === 'jpg' ? 'jpeg' : image.type
    return type === mime && image.width > 0 && image.width === image.height && image.width <= AVATAR_SIZE
  } catch (error) {
    // Unsupported or truncated image headers are invalid input.
    return false
  }
}

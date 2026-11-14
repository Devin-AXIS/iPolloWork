/** Shared avatar presentation and a cancellable local-image upload. */
import { useEffect, useRef, useState } from 'react'
import { IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { AVATAR_MAX_DATA_URL_LENGTH, AVATAR_MAX_UPLOAD_BYTES, AVATAR_SIZE } from '../shared/avatar.ts'
import type { AgentLabels } from './agent-locale.ts'
import css from './suite.module.css'

/** Display a saved image, retaining the initial when the image cannot decode. */
export function BotAvatar({ name, avatar, large = false }: { name: string; avatar?: string | undefined; large?: boolean }) {
  const [failed, setFailed] = useState<string>()
  return <span className={`${css.botAvatar} ${large ? css.botAvatarLarge : ''}`} aria-hidden="true">
    {avatar && failed !== avatar ? <img src={avatar} alt="" onError={() => setFailed(avatar)} /> : Array.from(name)[0] || <IconUsersOutlineRegular size={24} />}
  </span>
}

/** Decode locally, crop the center square and encode a compact raster preview.
 * @param file User-selected image; no original image is uploaded.
 * @returns A bounded WebP or browser-fallback PNG data URL.
 */
async function prepareAvatar(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('IPOLLO_AVATAR_FORMAT')
  if (file.size > AVATAR_MAX_UPLOAD_BYTES) throw new Error('IPOLLO_AVATAR_SIZE')
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }) }
  catch (error) { throw new Error('IPOLLO_AVATAR_INVALID', { cause: error }) }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_SIZE; canvas.height = AVATAR_SIZE
    const context = canvas.getContext('2d')
    if (!context) throw new Error('IPOLLO_AVATAR_INVALID')
    const side = Math.min(bitmap.width, bitmap.height)
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
    const result = canvas.toDataURL('image/webp', 0.85)
    if (result.length > AVATAR_MAX_DATA_URL_LENGTH) throw new Error('IPOLLO_AVATAR_SIZE')
    return result
  } finally { bitmap.close() }
}

interface PickerProps {
  name: string; value: string; disabled: boolean; t: AgentLabels;
  onChange(value: string): void; onProcessing(value: boolean): void;
}
/** Keep the previous avatar when decoding fails and ignore work after dismissal. */
export function AvatarPicker({ name, value, disabled, t, onChange, onProcessing }: PickerProps) {
  const input = useRef<HTMLInputElement>(null)
  const sequence = useRef(0)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => () => { sequence.current++ }, [])
  const choose = async (file: File) => {
    const revision = ++sequence.current
    setProcessing(true); setError(''); onProcessing(true)
    try {
      const image = await prepareAvatar(file)
      if (revision === sequence.current) onChange(image)
    } catch (problem) {
      if (revision === sequence.current) setError(problem instanceof Error ? problem.message : 'IPOLLO_AVATAR_INVALID')
    } finally {
      if (revision === sequence.current) { setProcessing(false); onProcessing(false) }
    }
  }
  return <div className={css.avatarUpload}>
    <BotAvatar name={name} avatar={value} large />
    <div className={css.avatarUploadBody}>
      <div className={css.avatarUploadActions}>
        <button type="button" className={css.secondary} disabled={disabled || processing} onClick={() => input.current?.click()}>{processing ? t.avatarProcessing : value ? t.changeAvatar : t.uploadAvatar}</button>
        {value && <button type="button" className={css.textAction} disabled={disabled || processing} onClick={() => { onChange(''); setError('') }}>{t.removeAvatar}</button>}
      </div>
      <p className={css.muted}>{t.avatarHint}</p>
      <input hidden ref={input} type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || processing} onChange={event => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) void choose(file)
      }} />
      {error && <p className={css.avatarError} role="alert">{(t as Record<string, string>)[error] ?? t.IPOLLO_AVATAR_INVALID}</p>}
    </div>
  </div>
}

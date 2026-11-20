import semver from 'semver'
import type { PublicationKind } from './enterprise.ts'

/** Labels stay within one URL segment; plugin installs require an exact package version. */
export function validPublicationVersion(value: unknown, kind: PublicationKind): value is string {
  if (typeof value !== 'string' || !value || value.length > 64 || value.trim() !== value) return false
  if (kind === 'plugin') return !value.includes('+') && semver.valid(value) === value
  return value !== '.' && value !== '..' && !/[\p{C}/\\?#%]/u.test(value)
}

/** Validate publication metadata before submitting any resource content. */
export function publicationInputError(input: unknown, kind: PublicationKind = 'plugin'): string | undefined {
  if (!input || typeof input !== 'object') return 'IPW_INVALID_INPUT'
  if (!('title' in input) || typeof input.title !== 'string' || !input.title.trim())
    return 'PUBLICATION_TITLE_REQUIRED'
  if (!('description' in input) || typeof input.description !== 'string' || !input.description.trim())
    return 'PUBLICATION_DESCRIPTION_REQUIRED'
  if (!('version' in input) || !validPublicationVersion(input.version, kind))
    return kind === 'plugin' ? 'PUBLICATION_VERSION_INVALID' : 'PUBLICATION_VERSION_LABEL_INVALID'
}

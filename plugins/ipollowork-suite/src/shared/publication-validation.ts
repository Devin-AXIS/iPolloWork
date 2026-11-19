import semver from 'semver'

/** Validate publication metadata before submitting any resource content. */
export function publicationInputError(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return 'IPW_INVALID_INPUT'
  if (!('title' in input) || typeof input.title !== 'string' || !input.title.trim())
    return 'PUBLICATION_TITLE_REQUIRED'
  if (!('description' in input) || typeof input.description !== 'string' || !input.description.trim())
    return 'PUBLICATION_DESCRIPTION_REQUIRED'
  if (!('version' in input) || typeof input.version !== 'string' || input.version.length > 64 ||
    input.version.includes('+') || semver.valid(input.version) !== input.version)
    return 'PUBLICATION_VERSION_INVALID'
}

/** Shared release-file reader. Server values never enter the Desktop projection. */
import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const releaseConfigVariable = 'IPOLLOWORK_RELEASE_CONFIG'

export function releaseObject(value, keys, name) {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`release configuration: ${name} must be an object`)
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`release configuration: unknown ${name} field ${key}`)
  }
  return value
}

export function releaseString(value, name) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`release configuration: ${name} must be a nonempty string`)
  }
  return value.trim()
}

export function releaseFile(value, directory, name) {
  const source = releaseString(value, name)
  if (source === undefined) return undefined
  const path = resolve(directory, source)
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`release configuration: ${name} must point to an existing file`)
  }
  return path
}

export function readReleaseConfig(environment, defaultPath) {
  const explicit = releaseString(environment[releaseConfigVariable], releaseConfigVariable)
  const path = explicit === undefined ? defaultPath : resolve(explicit)
  if (path === undefined) return undefined
  let contents
  try { contents = readFileSync(path, 'utf8') }
  catch (error) {
    if (explicit === undefined && error.code === 'ENOENT') return undefined
    throw new Error('release configuration: cannot read the selected JSON file', { cause: error })
  }
  let raw
  try { raw = JSON.parse(contents.replace(/^\uFEFF/u, '')) }
  catch { throw new Error('release configuration: the selected file is not valid JSON') }
  const value = releaseObject(raw, ['version', 'desktop', 'server'], 'root')
  if (value.version !== 1) throw new Error('release configuration: version must be 1')
  return { path, directory: dirname(path), desktop: value.desktop, server: value.server }
}

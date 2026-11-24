/** Build updater feeds only from complete, numeric, hash-verified release assets. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

export function numericReleaseVersion(tag) {
  if (!/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) throw new Error('Release version must contain three numeric parts, for example 1.0.2')
  return tag.replace(/^v/, '')
}

export function windowsUpdateFilename(version) {
  return `ipollowork-win-x64-${version}-unsigned.exe`
}

export function windowsUpdateUrl(version) {
  return `https://github.com/Devin-AXIS/iPolloWork/releases/download/v${version}/${windowsUpdateFilename(version)}`
}

export function updateFeeds(version, assets, ipolloPluginCompatibility) {
  numericReleaseVersion(version)
  const required = [`iPollo-${version}-mac-arm64.zip`, `iPollo-${version}-mac-x64.zip`, windowsUpdateFilename(version)]
  const files = required.map(name => {
    const found = assets.find(asset => asset.name === name)
    if (!found || !/^[A-Za-z0-9+/]{86}==$/.test(found.sha512) || !Number.isSafeInteger(found.size) || found.size <= 0) {
      throw new Error(`Missing or invalid update artifact: ${name}`)
    }
    // NSIS derives the previous blockmap URL by substituting the version in the artifact URL.
    const url = name === windowsUpdateFilename(version) ? windowsUpdateUrl(version) : name
    return { url, sha512: found.sha512, size: found.size }
  })
  const document = entries => JSON.stringify({
    version, files: entries, path: entries[0].url, sha512: entries[0].sha512, ipolloPluginCompatibility,
  }, null, 2) + '\n'
  // JSON is valid YAML and preserves exact names, sizes and base64 hashes.
  return { 'stable-mac.yml': document(files.slice(0, 2)), 'stable.yml': document(files.slice(2)) }
}

export async function hashReleaseAsset(path) {
  const sha256 = createHash('sha256'), sha512 = createHash('sha512')
  let size = 0
  for await (const chunk of createReadStream(path)) { size += chunk.length; sha256.update(chunk); sha512.update(chunk) }
  return { size, sha256: sha256.digest('hex'), sha512: sha512.digest('base64') }
}

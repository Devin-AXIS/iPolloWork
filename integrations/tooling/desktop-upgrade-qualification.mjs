/** Verify operator-reviewed desktop upgrade evidence against the exact release files. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export const upgradeQualificationFilename = 'desktop-upgrade-qualification.json'
const sha256 = /^[a-f0-9]{64}$/u
const commitHash = /^[a-f0-9]{40}$/u
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))

function version(value) {
  const match = typeof value === 'string' ? versionPattern.exec(value) : null
  assert.ok(match, 'Upgrade qualification requires an exact semantic version')
  return { core: match.slice(1, 4).map(BigInt), suffix: match[4]?.split('.') }
}

function older(left, right) {
  const a = version(left), b = version(right)
  const difference = a.core.findIndex((part, index) => part !== b.core[index])
  if (difference !== -1) return a.core[difference] < b.core[difference]
  if (!a.suffix) return false
  if (!b.suffix) return true
  for (const [index, part] of a.suffix.entries()) {
    const other = b.suffix[index]
    if (other === undefined) return false
    if (part === other) continue
    const numeric = /^\d+$/u.test(part), otherNumeric = /^\d+$/u.test(other)
    if (numeric && otherNumeric) return BigInt(part) < BigInt(other)
    if (numeric !== otherNumeric) return numeric
    return part < other
  }
  return a.suffix.length < b.suffix.length
}

function requirePassed(check, description) {
  assert.equal(check?.result, 'pass', `Upgrade qualification missing a pass for ${description}`)
  const url = typeof check.evidence === 'string' && check.evidence.length <= 512 ? URL.parse(check.evidence) : null
  assert.ok(url?.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash,
    `Upgrade qualification requires an HTTPS evidence link for ${description}`)
}

/** Validate a report without contacting its evidence links. */
export function verifyUpgradeQualification(report, expected) {
  assert.equal(report?.schemaVersion, 1, 'Unsupported upgrade qualification schema')
  assert.equal(report.version, expected.version, 'Upgrade qualification version mismatch')
  assert.ok(commitHash.test(expected.commit ?? '') && report.commit === expected.commit, 'Upgrade qualification source commit mismatch')
  assert.deepEqual(report.dsh, expected.dsh, 'Upgrade qualification DSH pin mismatch')
  for (const [target, artifacts] of Object.entries(expected.targets)) {
    assert.ok(artifacts.length > 0, `Upgrade qualification requires verified package bytes for ${target}`)
    const entry = report.targets?.[target]
    assert.ok(entry, `Upgrade qualification missing ${target}`)
    for (const artifact of artifacts) {
      assert.ok(sha256.test(artifact.sha256) && entry.artifacts?.[artifact.name] === artifact.sha256,
        `Upgrade qualification package digest mismatch for ${target}: ${artifact.name}`)
    }
    const previous = entry.upgrade?.previous, legacy = entry.upgrade?.legacy
    requirePassed(previous, `${target} previous installed upgrade`)
    requirePassed(legacy, `${target} legacy installed upgrade`)
    if (expected.previousVersion !== undefined) {
      assert.equal(previous.from, expected.previousVersion, `Upgrade qualification must start from current Latest for ${target}`)
    }
    assert.ok(older(legacy.from, previous.from) && older(previous.from, expected.version),
      `Upgrade qualification needs two distinct older baselines for ${target}`)
    for (const name of ['core', 'plugins', 'recovery']) requirePassed(entry[name], `${target} ${name}`)
  }
}

/** Load a bounded report and use the runtime pin from the package source, not the publisher checkout. */
export async function requireUpgradeQualification(path, expected) {
  assert.match(expected.commit ?? '', commitHash, 'Upgrade qualification requires a recorded commit')
  const file = await lstat(path).catch(error => {
    if (error.code === 'ENOENT') throw new Error(`Missing ${upgradeQualificationFilename}. Run the desktop-upgrade-qualification skill before production publication.`)
    throw error
  })
  assert.ok(file.isFile() && file.size <= 64 * 1024, 'Invalid desktop upgrade qualification file')
  const bytes = await readFile(path)
  let report
  try { report = JSON.parse(bytes.toString('utf8')) }
  catch { throw new Error('Invalid desktop upgrade qualification JSON') }
  const pin = JSON.parse(execFileSync('git', ['show', `${expected.commit}:integrations/runtime/upstream.json`],
    { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 64 * 1024 }))
  assert.ok(typeof pin.npmVersion === 'string' && commitHash.test(pin.sourceRevision ?? ''), 'Invalid packaged DSH pin')
  verifyUpgradeQualification(report, { ...expected, dsh: { version: pin.npmVersion, revision: pin.sourceRevision } })
  return createHash('sha256').update(bytes).digest('hex')
}

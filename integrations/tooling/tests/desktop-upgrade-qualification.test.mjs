import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { requireUpgradeQualification, upgradeQualificationFilename, verifyUpgradeQualification } from '../desktop-upgrade-qualification.mjs'
import { prepareRelease, requireGitHubUpgradeQualification } from '../release-publication.mjs'
import { requireProductionDesktopUpgrade } from '../../desktop/scripts/require-desktop-upgrade-qualification.ts'

const pass = { result: 'pass', evidence: 'https://example.test/qualification/run/123' }
const artifact = { name: 'ipollowork-win-x64-1.0.17-unsigned.exe', sha256: 'a'.repeat(64) }
const expected = { version: '1.0.17', commit: 'b'.repeat(40), dsh: { version: '0.2.3-alpha.2', revision: 'c'.repeat(40) },
  previousVersion: '1.0.16', targets: { 'win-x64': [artifact] } }

function entry(artifacts = [artifact]) {
  return { artifacts: Object.fromEntries(artifacts.map(file => [file.name, file.sha256])),
    upgrade: { previous: { ...pass, from: '1.0.16' }, legacy: { ...pass, from: '1.0.10' } },
    core: { ...pass }, plugins: { ...pass }, recovery: { ...pass } }
}

function report(identity = expected) {
  return { schemaVersion: 1, version: identity.version, commit: identity.commit, dsh: identity.dsh, targets: { 'win-x64': entry() } }
}

test('requires passing evidence for both installed baselines and the three related checks', () => {
  verifyUpgradeQualification(report(), expected)
  for (const name of ['core', 'plugins', 'recovery']) {
    const incomplete = report()
    incomplete.targets['win-x64'][name].result = 'pending'
    assert.throws(() => verifyUpgradeQualification(incomplete, expected), new RegExp(name))
  }
  const incomplete = report()
  incomplete.targets['win-x64'].upgrade.previous.result = 'failed'
  assert.throws(() => verifyUpgradeQualification(incomplete, expected), /previous installed upgrade/u)
  const same = report()
  same.targets['win-x64'].upgrade.legacy.from = '1.0.16'
  assert.throws(() => verifyUpgradeQualification(same, expected), /distinct older baselines/u)
  const wrong = report()
  wrong.targets['win-x64'].upgrade.previous.from = '1.0.15'
  assert.throws(() => verifyUpgradeQualification(wrong, expected), /current Latest/u)
  const unsafe = report()
  unsafe.targets['win-x64'].plugins.evidence += '?secret=fixture'
  assert.throws(() => verifyUpgradeQualification(unsafe, expected), /HTTPS evidence link/u)
})

test('rejects results for another candidate hash, source, DSH pin, or platform', () => {
  assert.throws(() => verifyUpgradeQualification(report(), { ...expected, version: '1.0.18' }), /version mismatch/u)
  assert.throws(() => verifyUpgradeQualification(report(), { ...expected, commit: 'd'.repeat(40) }), /commit mismatch/u)
  assert.throws(() => verifyUpgradeQualification(report(), { ...expected, dsh: { ...expected.dsh, version: '0.2.4' } }), /pin mismatch/u)
  assert.throws(() => verifyUpgradeQualification(report(), { ...expected, targets: { 'win-x64': [{ ...artifact, sha256: 'b'.repeat(64) }] } }), /digest mismatch/u)
  assert.throws(() => verifyUpgradeQualification(report(), { ...expected, targets: { ...expected.targets, 'mac-x64': [artifact] } }), /missing mac-x64/u)
})

test('the GitHub publisher requires the report asset and the report covers every candidate platform', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ipollo-upgrade-qualification-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const pin = JSON.parse(execFileSync('git', ['show', `${commit}:integrations/runtime/upstream.json`], { encoding: 'utf8' }))
  const identity = { ...expected, commit, dsh: { version: pin.npmVersion, revision: pin.sourceRevision } }
  const release = { tag_name: 'v1.0.17', target_commitish: commit }
  const mac = arch => [`iPollo-1.0.17-mac-${arch}.zip`, `ipollowork-mac-${arch}-1.0.17.dmg`].map(name => ({ ...artifact, name }))
  const assets = [artifact, ...mac('arm64'), ...mac('x64')]
  await assert.rejects(requireGitHubUpgradeQualification(release, directory, { assets }), /Draft release is missing/u)
  assets.push({ name: upgradeQualificationFilename })
  const path = join(directory, upgradeQualificationFilename)
  await assert.rejects(requireUpgradeQualification(path, identity), /Missing desktop-upgrade-qualification/u)
  const candidate = report(identity)
  await writeFile(path, JSON.stringify(candidate))
  await assert.rejects(requireGitHubUpgradeQualification(release, directory, { assets }), /missing mac-arm64/u)
  for (const arch of ['arm64', 'x64']) candidate.targets[`mac-${arch}`] = entry(mac(arch))
  await writeFile(path, JSON.stringify(candidate))
  assert.match(await requireGitHubUpgradeQualification(release, directory, { assets }, '1.0.16'), /^[a-f0-9]{64}$/u)
})

test('COS production requires evidence for the actual payload while the test channel can run without it', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ipollo-upgrade-cos-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const plan = { environment: 'production', version: '1.0.17', target: 'win-x64', dirty: false,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    artifacts: [{ path: join(directory, artifact.name) }] }
  assert.equal(await requireProductionDesktopUpgrade({ ...plan, environment: 'test' }), undefined)
  const bytes = 'candidate installer bytes'
  await writeFile(plan.artifacts[0].path, bytes)
  await assert.rejects(requireProductionDesktopUpgrade(plan), /Missing desktop-upgrade-qualification/u)
  const pin = JSON.parse(execFileSync('git', ['show', `${plan.commit}:integrations/runtime/upstream.json`], { encoding: 'utf8' }))
  const receipt = report({ ...plan, dsh: { version: pin.npmVersion, revision: pin.sourceRevision } })
  receipt.targets['win-x64'].artifacts[artifact.name] = createHash('sha256').update(bytes).digest('hex')
  await writeFile(join(directory, upgradeQualificationFilename), JSON.stringify(receipt))
  assert.match(await requireProductionDesktopUpgrade(plan), /^[a-f0-9]{64}$/u)
  await writeFile(plan.artifacts[0].path, 'replacement bytes')
  await assert.rejects(requireProductionDesktopUpgrade(plan), /package digest mismatch/u)
})

test('preparing a production GitHub release stops before writing a feed when the report is absent', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ipollo-upgrade-prepare-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const bytes = Buffer.from('release candidate fixture')
  await writeFile(join(directory, artifact.name), bytes)
  const release = { tag_name: 'v1.0.17', target_commitish: expected.commit, assets: [{
    name: artifact.name, size: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  }] }
  await assert.rejects(prepareRelease(release, directory, { previousVersion: '1.0.16' }), /Draft release is missing/u)
  await assert.rejects(access(join(directory, 'stable.yml')), { code: 'ENOENT' })
})

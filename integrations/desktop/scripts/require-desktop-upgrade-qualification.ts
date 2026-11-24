/** Require upgrade acceptance for production COS uploads of a version or website installer. */
import { basename, dirname, join } from 'node:path'
import type { DesktopUploadPlan } from './desktop-upload-plan.ts'
import { hashReleaseAsset } from '../../tooling/release-update-feed.mjs'
import { requireUpgradeQualification, upgradeQualificationFilename } from '../../tooling/desktop-upgrade-qualification.mjs'

export async function requireProductionDesktopUpgrade(plan: DesktopUploadPlan): Promise<string | undefined> {
  if (plan.environment !== 'production') return undefined
  if (plan.dirty !== false || plan.commit === undefined) throw new Error('Upgrade qualification requires a clean, recorded desktop package')
  const packages = plan.artifacts.filter(artifact => /\.(?:dmg|exe|zip)$/u.test(artifact.path))
  const first = packages[0]
  if (first === undefined) throw new Error('Upgrade qualification requires the packaged desktop payload')
  const artifacts = await Promise.all(packages.map(async artifact => ({
    name: basename(artifact.path), sha256: (await hashReleaseAsset(artifact.path)).sha256,
  })))
  return requireUpgradeQualification(join(dirname(first.path), upgradeQualificationFilename), {
    version: plan.version, commit: plan.commit, targets: { [plan.target]: artifacts },
  })
}

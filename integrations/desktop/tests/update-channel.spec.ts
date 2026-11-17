import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { desktopUpdateChannel, fixedDesktopUpdateChannel } from '../src/update-channel.ts'

it('reads the installed channel independently from the current version', () => {
  expect(desktopUpdateChannel({ version: '1.0.0', dshDesktopUpdateChannel: 'nightly' })).toBe('nightly')
  expect(desktopUpdateChannel({ version: '1.0.0', dshDesktopUpdateChannel: 'stable' })).toBe('stable')
  expect(desktopUpdateChannel({ version: '1.0.0' })).toBe('nightly')
  expect(() => desktopUpdateChannel({ dshDesktopUpdateChannel: 'latest' })).toThrow(/channel/u)
  expect(() => desktopUpdateChannel({ dshDesktopUpdateChannel: 'beta' })).toThrow(/channel/u)
  expect(() => desktopUpdateChannel(null)).toThrow(/manifest/u)
})

it.each([
  ['https://github.com/Devin-AXIS/iPolloWork/releases/latest/download/', 'stable'],
  ['https://github.com/devin-axis/ipollowork/releases/latest/download', 'stable'],
  ['https://github.com/another-owner/iPolloWork/releases/latest/download/', undefined],
  ['https://downloads.example.com/desktop/win-x64/', undefined],
  ['https://github.com/Devin-AXIS/iPolloWork/releases/latest/download/?custom=1', undefined],
])('only fixes the channel of the official stable release source %s', async (url, channel) => {
  const root = await mkdtemp(join(tmpdir(), 'ipollo-update-channel-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'app-update.yml')
  await writeFile(path, `provider: generic\nurl: ${url}\n`)
  await expect(fixedDesktopUpdateChannel(path)).resolves.toBe(channel)
})

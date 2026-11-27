import { constants } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  canMoveMacApplication,
  isMacReadOnlyUpdateError,
  macApplicationBundle,
  macUpdateLocationIsReadOnly,
} from '../src/macos-update-location.ts'

const installed = '/Applications/iPolloWork.app'
const diskImage = '/Volumes/iPolloWork/iPolloWork.app'
const translocated = '/private/var/folders/ab/cd/T/AppTranslocation/A1B2/d/iPolloWork.app'
const fsError = (code: string) => Object.assign(new Error(code), { code })

describe('macOS update location', () => {
  it.each([installed, diskImage, translocated])('finds the containing bundle at %s', (bundle) => {
    expect(macApplicationBundle(bundle + '/Contents/MacOS/iPolloWork')).toBe(bundle)
    expect(macApplicationBundle('/opt/ipollowork')).toBeUndefined()
  })

  it('recognizes translocation regardless of reported access permissions', async () => {
    const check = vi.fn().mockResolvedValue(undefined)
    await expect(macUpdateLocationIsReadOnly(translocated, check)).resolves.toBe(true)
    expect(check).not.toHaveBeenCalled()
  })

  it('distinguishes a read-only disk image from a writable location or a permissions error', async () => {
    const check = vi.fn().mockRejectedValueOnce(fsError('EROFS')).mockResolvedValueOnce(undefined).mockRejectedValueOnce(fsError('EACCES'))
    await expect(macUpdateLocationIsReadOnly(diskImage, check)).resolves.toBe(true)
    expect(check).toHaveBeenCalledWith(diskImage, constants.W_OK)
    await expect(macUpdateLocationIsReadOnly(installed, check)).resolves.toBe(false)
    await expect(macUpdateLocationIsReadOnly(installed, check)).resolves.toBe(false)
  })

  it.each([
    'Cannot update while running on a read-only volume. The application is on a read-only volume.',
    'The application is on a read only volume.',
    'Error Domain=SQRLUpdaterErrorDomain Code=8',
  ])('recognizes the native error %s', (message) => {
    expect(isMacReadOnlyUpdateError(message)).toBe(true)
  })

  it.each(['EROFS: read-only file system, mkdir ~/Library/Caches/ipollo-updater', 'SQRLUpdaterErrorDomain Code=80', undefined])(
    'preserves the original error handling for %s', (message) => {
      expect(isMacReadOnlyUpdateError(message)).toBe(false)
    },
  )

  it('allows a move only when Applications is writable and the destination is absent', async () => {
    const check = vi.fn().mockResolvedValue(undefined)
    const inspect = vi.fn().mockRejectedValueOnce(fsError('ENOENT')).mockResolvedValueOnce({}).mockRejectedValueOnce(fsError('EACCES'))
    await expect(canMoveMacApplication(diskImage, check, inspect)).resolves.toBe(true)
    expect(check).toHaveBeenCalledWith('/Applications', constants.W_OK | constants.X_OK)
    expect(inspect).toHaveBeenCalledWith(installed)
    await expect(canMoveMacApplication(diskImage, check, inspect)).resolves.toBe(false)
    await expect(canMoveMacApplication(diskImage, check, inspect)).resolves.toBe(false)
    check.mockRejectedValueOnce(fsError('EACCES'))
    await expect(canMoveMacApplication(diskImage, check, inspect)).resolves.toBe(false)
    expect(inspect).toHaveBeenCalledTimes(3)
  })
})

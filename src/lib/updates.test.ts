import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkForAppUpdate, installAppUpdate } from './updates'

const updateMocks = vi.hoisted(() => ({
  check: vi.fn(),
  isDesktopRuntime: vi.fn(() => true),
  relaunch: vi.fn()
}))

vi.mock('./backend', () => ({
  isDesktopRuntime: updateMocks.isDesktopRuntime
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: updateMocks.check
}))

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: updateMocks.relaunch
}))

describe('application updater', () => {
  beforeEach(() => {
    updateMocks.check.mockReset()
    updateMocks.isDesktopRuntime.mockReset()
    updateMocks.isDesktopRuntime.mockReturnValue(true)
    updateMocks.relaunch.mockReset()
  })

  it('returns updater metadata and installs before relaunching', async () => {
    const downloadAndInstall = vi.fn(
      async (
        onEvent: (event: {
          data?: { chunkLength?: number; contentLength?: number }
          event: 'Finished' | 'Progress' | 'Started'
        }) => void
      ): Promise<void> => {
        onEvent({ data: { contentLength: 100 }, event: 'Started' })
        onEvent({ data: { chunkLength: 40 }, event: 'Progress' })
        onEvent({ event: 'Finished' })
      }
    )
    updateMocks.check.mockResolvedValue({
      body: '## Faster',
      currentVersion: '0.1.0',
      date: '2026-07-24T00:00:00Z',
      downloadAndInstall,
      version: '0.2.0'
    })

    await expect(checkForAppUpdate('0.1.0')).resolves.toEqual({
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      publishedAt: '2026-07-24T00:00:00Z',
      releaseNotes: '## Faster',
      updateAvailable: true
    })

    const progress: string[] = []
    await installAppUpdate((event) => progress.push(event.phase))

    expect(downloadAndInstall).toHaveBeenCalledOnce()
    expect(progress).toEqual(['downloading', 'downloading', 'installing', 'relaunching'])
    expect(updateMocks.relaunch).toHaveBeenCalledOnce()
  })

  it('does not call the native updater in a browser preview', async () => {
    updateMocks.isDesktopRuntime.mockReturnValue(false)

    await expect(checkForAppUpdate('0.1.0')).resolves.toEqual({
      currentVersion: '0.1.0',
      latestVersion: '0.1.0',
      releaseNotes: '',
      updateAvailable: false
    })
    expect(updateMocks.check).not.toHaveBeenCalled()
  })
})

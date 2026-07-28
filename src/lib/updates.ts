import type { Update } from '@tauri-apps/plugin-updater'
import type { AppUpdateInfo } from '../types'
import { isDesktopRuntime } from './backend'
import { APP_VERSION } from './version'

let pendingUpdate: Update | null = null

export type AppUpdatePhase = 'downloading' | 'installing' | 'relaunching'

export interface AppUpdateProgress {
  downloadedBytes: number
  phase: AppUpdatePhase
  totalBytes?: number
}

export const checkForAppUpdate = async (
  currentVersion: string = APP_VERSION
): Promise<AppUpdateInfo> => {
  if (!isDesktopRuntime()) {
    return {
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
      releaseNotes: ''
    }
  }

  const { check } = await import('@tauri-apps/plugin-updater')
  const update = await check()
  pendingUpdate = update

  if (!update) {
    return {
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
      releaseNotes: ''
    }
  }

  return {
    currentVersion: update.currentVersion,
    latestVersion: update.version,
    updateAvailable: true,
    releaseNotes: update.body?.trim() ?? '',
    publishedAt: update.date
  }
}

export const installAppUpdate = async (
  onProgress: (progress: AppUpdateProgress) => void
): Promise<void> => {
  if (!pendingUpdate) {
    throw new Error('No application update is ready to install')
  }

  let downloadedBytes = 0
  let totalBytes: number | undefined

  await pendingUpdate.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      totalBytes = event.data.contentLength
      onProgress({ downloadedBytes, phase: 'downloading', totalBytes })
      return
    }

    if (event.event === 'Progress') {
      downloadedBytes += event.data.chunkLength
      onProgress({ downloadedBytes, phase: 'downloading', totalBytes })
      return
    }

    onProgress({ downloadedBytes, phase: 'installing', totalBytes })
  })

  onProgress({ downloadedBytes, phase: 'relaunching', totalBytes })
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
}

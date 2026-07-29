import type { Update } from '@tauri-apps/plugin-updater'
import type { AppUpdateInfo } from '../types'
import { appendDiagnosticLog, isDesktopRuntime } from './backend'
import { APP_VERSION } from './version'

let pendingUpdate: Update | null = null

export class AppUpdateFailure extends Error {
  readonly logPath?: string

  constructor(message: string, logPath?: string) {
    super(message)
    this.name = 'AppUpdateFailure'
    this.logPath = logPath
  }
}

const errorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }
  try {
    const serialized = JSON.stringify(error)
    return serialized && serialized !== '{}' ? serialized : 'Unknown updater error'
  } catch {
    return 'Unknown updater error'
  }
}

const updateFailure = async (
  operation: 'check' | 'install',
  error: unknown,
  details: string[] = []
) => {
  const message = errorMessage(error)
  let logPath: string | undefined
  try {
    logPath = await appendDiagnosticLog(
      [
        `Updater ${operation} failed: ${message}`,
        `Current version: ${APP_VERSION}`,
        ...details
      ].join('\n')
    )
  } catch {
    // Keep the original updater failure even when diagnostic logging is unavailable.
  }
  return new AppUpdateFailure(message, logPath)
}

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

  pendingUpdate = null
  try {
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
  } catch (error) {
    throw await updateFailure('check', error)
  }
}

export const installAppUpdate = async (
  onProgress: (progress: AppUpdateProgress) => void
): Promise<void> => {
  let downloadedBytes = 0
  let phase: AppUpdatePhase | 'preparing' = 'preparing'
  let totalBytes: number | undefined

  try {
    if (!pendingUpdate) {
      throw new Error('No application update is ready to install')
    }

    await pendingUpdate.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        phase = 'downloading'
        totalBytes = event.data.contentLength
        onProgress({ downloadedBytes, phase, totalBytes })
        return
      }

      if (event.event === 'Progress') {
        phase = 'downloading'
        downloadedBytes += event.data.chunkLength
        onProgress({ downloadedBytes, phase, totalBytes })
        return
      }

      phase = 'installing'
      onProgress({ downloadedBytes, phase, totalBytes })
    })

    phase = 'relaunching'
    onProgress({ downloadedBytes, phase, totalBytes })
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch (error) {
    if (error instanceof AppUpdateFailure) {
      throw error
    }
    const details = [
      `Phase: ${phase}`,
      `Downloaded bytes: ${downloadedBytes}`,
      `Total bytes: ${totalBytes ?? 'unknown'}`
    ]
    if (pendingUpdate) {
      details.push(`Latest version: ${pendingUpdate.version}`)
    }
    throw await updateFailure('install', error, details)
  }
}

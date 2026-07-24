import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import {
  type AppSettings,
  type BrowserMediaCandidate,
  type BrowserStateSnapshot,
  type DownloadItem,
  defaultSettings,
  type MediaInfo,
  type RuntimeInfo,
  type StartDownloadRequest
} from '../types'
import { APP_VERSION } from './version'

export const isDesktopRuntime = (): boolean => '__TAURI_INTERNALS__' in window

export const getSettings = async (): Promise<AppSettings> => {
  if (!isDesktopRuntime()) {
    return defaultSettings
  }
  return await invoke<AppSettings>('get_settings')
}

export const saveSettings = async (settings: AppSettings): Promise<AppSettings> => {
  if (!isDesktopRuntime()) {
    return settings
  }
  return await invoke<AppSettings>('save_settings', { settings })
}

export const getHistory = async (): Promise<DownloadItem[]> => {
  if (!isDesktopRuntime()) {
    return []
  }
  return await invoke<DownloadItem[]>('get_history')
}

export type ProbeDetail = 'full' | 'summary'

export const probeUrl = async (
  url: string,
  referer?: string,
  detail: ProbeDetail = 'full'
): Promise<MediaInfo> => {
  if (!isDesktopRuntime()) {
    throw new Error('DESKTOP_RUNTIME_REQUIRED')
  }
  return await invoke<MediaInfo>('probe_url', { detail, referer, url })
}

export const startDownload = async (request: StartDownloadRequest): Promise<DownloadItem> => {
  if (!isDesktopRuntime()) {
    throw new Error('DESKTOP_RUNTIME_REQUIRED')
  }
  return await invoke<DownloadItem>('start_download', { request })
}

export const retryDownload = async (id: string): Promise<DownloadItem> => {
  if (!isDesktopRuntime()) {
    throw new Error('DESKTOP_RUNTIME_REQUIRED')
  }
  return await invoke<DownloadItem>('retry_download', { id })
}

export const cancelDownload = async (id: string): Promise<void> => {
  if (!isDesktopRuntime()) {
    return
  }
  await invoke('cancel_download', { id })
}

export const pauseDownload = async (id: string): Promise<void> => {
  if (!isDesktopRuntime()) {
    return
  }
  await invoke('pause_download', { id })
}

export const resumeDownload = async (id: string): Promise<void> => {
  if (!isDesktopRuntime()) {
    return
  }
  await invoke('resume_download', { id })
}

export const renameDownloadTitle = async (id: string, title: string): Promise<void> => {
  if (!isDesktopRuntime()) {
    return
  }
  await invoke('rename_download_title', { id, title })
}

export const renamePlaylist = async (playlistId: string, title: string): Promise<void> => {
  if (!isDesktopRuntime()) {
    return
  }
  await invoke('rename_playlist', { playlistId, title })
}

export const removeHistoryItem = async (id: string): Promise<void> => {
  if (!isDesktopRuntime()) {
    return
  }
  await invoke('remove_history_item', { id })
}

export const deleteDownloadedFile = async (id: string): Promise<void> => {
  if (!isDesktopRuntime()) {
    return
  }
  await invoke('delete_downloaded_file', { id })
}

export const clearFinishedHistory = async (): Promise<void> => {
  if (!isDesktopRuntime()) {
    return
  }
  await invoke('clear_finished_history')
}

export const openDownloadedFile = async (path: string): Promise<void> => {
  if (!isDesktopRuntime()) {
    return
  }
  await invoke('open_downloaded_file', { path })
}

export const revealDownloadedFile = async (path: string): Promise<void> => {
  if (!isDesktopRuntime()) {
    return
  }
  await invoke('reveal_downloaded_file', { path })
}

export const openExternalUrl = async (url: string): Promise<void> => {
  const parsedUrl = new URL(url)
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs can be opened')
  }
  if (isDesktopRuntime()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(parsedUrl.toString())
    return
  }
  window.open(parsedUrl.toString(), '_blank', 'noopener,noreferrer')
}

export const getRuntimeInfo = async (): Promise<RuntimeInfo> => {
  if (!isDesktopRuntime()) {
    return {
      version: APP_VERSION,
      platform: navigator.platform || 'Browser preview',
      architecture: 'web',
      ytDlpReady: false,
      ffmpegReady: false
    }
  }
  return await invoke<RuntimeInfo>('get_runtime_info')
}

export const selectDirectory = async (): Promise<string | null> => {
  if (!isDesktopRuntime()) {
    return null
  }
  const selection = await open({ directory: true, multiple: false })
  return typeof selection === 'string' ? selection : null
}

export const selectCookiesFile = async (): Promise<string | null> => {
  if (!isDesktopRuntime()) {
    return null
  }
  const selection = await open({
    directory: false,
    filters: [{ name: 'Cookies', extensions: ['txt'] }],
    multiple: false
  })
  return typeof selection === 'string' ? selection : null
}

export const selectConfigFile = async (): Promise<string | null> => {
  if (!isDesktopRuntime()) {
    return null
  }
  const selection = await open({ directory: false, multiple: false })
  return typeof selection === 'string' ? selection : null
}

export const readClipboardUrl = async (): Promise<string> => {
  if (isDesktopRuntime()) {
    const { readText } = await import('@tauri-apps/plugin-clipboard-manager')
    return await readText()
  }
  return await navigator.clipboard.readText()
}

export const listenForDownloadUpdates = async (
  handler: (item: DownloadItem) => void
): Promise<UnlistenFn> => {
  if (!isDesktopRuntime()) {
    return () => undefined
  }
  return await listen<DownloadItem>('download-updated', (event) => {
    handler(event.payload)
  })
}

export type TrayAction = 'about' | 'settings' | 'check-updates'

export const listenForTrayActions = async (
  handler: (action: TrayAction) => void
): Promise<UnlistenFn> => {
  if (!isDesktopRuntime()) {
    return () => undefined
  }
  return await listen<TrayAction>('tray-action', (event) => {
    handler(event.payload)
  })
}

export const openMediaBrowser = async (
  language: AppSettings['language'],
  theme: AppSettings['theme'],
  title: string
): Promise<void> => {
  if (!isDesktopRuntime()) {
    return
  }
  await invoke('open_media_browser', { language, theme, title })
}

export const getBrowserState = async (): Promise<BrowserStateSnapshot> => {
  if (!isDesktopRuntime()) {
    return { candidates: [], loading: false, mediaPanelOpen: false, pageUrl: '', title: '' }
  }
  return await invoke<BrowserStateSnapshot>('get_browser_state')
}

export const listenForBrowserState = async (
  handler: (state: BrowserStateSnapshot) => void
): Promise<UnlistenFn> => {
  if (!isDesktopRuntime()) {
    return () => undefined
  }
  return await listen<BrowserStateSnapshot>('browser-state-changed', (event) => {
    handler(event.payload)
  })
}

export const listenForBrowserMediaSelection = async (
  handler: (candidate: BrowserMediaCandidate) => void
): Promise<UnlistenFn> => {
  if (!isDesktopRuntime()) {
    return () => undefined
  }
  return await listen<BrowserMediaCandidate>('browser-media-selected', (event) => {
    handler(event.payload)
  })
}

export const browserNavigate = async (input: string): Promise<void> => {
  await invoke('browser_navigate', { input })
}

export const browserBack = async (): Promise<void> => {
  await invoke('browser_back')
}

export const browserForward = async (): Promise<void> => {
  await invoke('browser_forward')
}

export const browserReload = async (): Promise<void> => {
  await invoke('browser_reload')
}

export const browserFocusAddress = async (): Promise<void> => {
  await invoke('browser_focus_address')
}

export const setBrowserMediaPanelOpen = async (open: boolean): Promise<void> => {
  await invoke('set_browser_media_panel_open', { open })
}

export const setBrowserMediaPanelWidth = async (width: number): Promise<void> => {
  await invoke('set_browser_media_panel_width', { width })
}

export const clearBrowserMedia = async (): Promise<void> => {
  await invoke('clear_browser_media')
}

export const selectBrowserMedia = async (id: string): Promise<void> => {
  await invoke('select_browser_media', { id })
}

export const controlWindow = async (action: 'minimize' | 'close'): Promise<void> => {
  if (!isDesktopRuntime()) {
    return
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const appWindow = getCurrentWindow()
  if (action === 'minimize') {
    await appWindow.minimize()
  } else {
    await appWindow.close()
  }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AboutPage } from './components/AboutPage'
import { DownloadPage } from './components/DownloadPage'
import { PanelDialog } from './components/PanelDialog'
import { SettingsPage } from './components/SettingsPage'
import { TitleBar } from './components/TitleBar'
import { UpdateDialog } from './components/UpdateDialog'
import {
  cancelDownload,
  clearFinishedHistory,
  deleteDownloadedFile,
  getHistory,
  getRuntimeInfo,
  getSettings,
  listenForBrowserMediaSelection,
  listenForBrowserState,
  listenForDownloadUpdates,
  listenForTrayActions,
  openDownloadedFile,
  openExternalUrl,
  openMediaBrowser,
  pauseDownload,
  probeUrl,
  removeHistoryItem,
  renameDownloadTitle,
  renamePlaylist,
  resumeDownload,
  retryDownload,
  revealDownloadedFile,
  saveSettings,
  startDownload
} from './lib/backend'
import { normalizeMediaUrl } from './lib/playlist'
import { checkForAppUpdate } from './lib/updates'
import { APP_VERSION } from './lib/version'
import {
  type AppSettings,
  type AppUpdateInfo,
  type BrowserMediaCandidate,
  type DownloadItem,
  defaultSettings,
  type RuntimeInfo,
  type StartDownloadRequest
} from './types'

const detectedPlatform =
  typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent) ? 'macos' : 'Unknown'

const defaultRuntimeInfo: RuntimeInfo = {
  version: APP_VERSION,
  platform: detectedPlatform,
  architecture: 'Unknown',
  ytDlpReady: false,
  ffmpegReady: false
}

const isFinished = (item: DownloadItem): boolean => {
  return item.status === 'completed' || item.status === 'error' || item.status === 'cancelled'
}

const sortDownloads = (items: DownloadItem[]): DownloadItem[] => {
  return [...items].sort((left, right) => right.createdAt - left.createdAt)
}

function App() {
  const { i18n, t } = useTranslation()
  const [openPanel, setOpenPanel] = useState<'about' | 'settings' | null>(null)
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo>(defaultRuntimeInfo)
  const [browserMediaCount, setBrowserMediaCount] = useState(0)
  const [browserSelection, setBrowserSelection] = useState<BrowserMediaCandidate | null>(null)
  const [toastMessage, setToastMessage] = useState('')
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [settingsReady, setSettingsReady] = useState(false)
  const settingsRevision = useRef(0)
  const autoUpdateChecked = useRef(false)
  const closePanel = useCallback(() => setOpenPanel(null), [])

  const mergeDownload = useCallback((nextItem: DownloadItem) => {
    setDownloads((currentItems) => {
      const index = currentItems.findIndex((item) => item.id === nextItem.id)
      if (index === -1) {
        return sortDownloads([nextItem, ...currentItems])
      }
      if (currentItems[index] === nextItem) {
        return currentItems
      }
      const nextItems = [...currentItems]
      nextItems[index] = nextItem
      return nextItems
    })
  }, [])

  useEffect(() => {
    let active = true
    let unlisten: (() => void) | undefined

    void listenForDownloadUpdates(mergeDownload).then((stopListening) => {
      if (active) {
        unlisten = stopListening
      } else {
        stopListening()
      }
    })

    const handleLoadError = () => {
      if (active) {
        setToastMessage(i18n.t('settings.loadFailed'))
      }
    }
    void getSettings()
      .then((storedSettings) => {
        if (active) {
          setSettings(storedSettings)
          void i18n.changeLanguage(storedSettings.language)
          setSettingsReady(true)
        }
      })
      .catch(() => {
        handleLoadError()
        if (active) {
          setSettingsReady(true)
        }
      })
    void getHistory()
      .then((history) => {
        if (active) {
          setDownloads(sortDownloads(history))
        }
      })
      .catch(handleLoadError)
    void getRuntimeInfo()
      .then((info) => {
        if (active) {
          setRuntimeInfo(info)
        }
      })
      .catch(handleLoadError)

    return () => {
      active = false
      unlisten?.()
    }
  }, [i18n, mergeDownload])

  const runUpdateCheck = useCallback(
    async (options?: { silent?: boolean; openDialogWhenAvailable?: boolean }) => {
      const silent = options?.silent ?? false
      const openDialogWhenAvailable = options?.openDialogWhenAvailable ?? true
      setUpdateChecking(true)
      try {
        const info = await checkForAppUpdate(runtimeInfo.version || APP_VERSION)
        setUpdateInfo(info)
        if (info.updateAvailable) {
          if (openDialogWhenAvailable) {
            setUpdateDialogOpen(true)
          }
        } else if (!silent) {
          setToastMessage(t('update.upToDate'))
        }
      } catch {
        if (!silent) {
          setToastMessage(t('update.checkFailed'))
        }
      } finally {
        setUpdateChecking(false)
      }
    },
    [runtimeInfo.version, t]
  )

  useEffect(() => {
    let active = true
    let unlisten: (() => void) | undefined
    void listenForTrayActions((action) => {
      if (action === 'check-updates') {
        setOpenPanel('about')
        void runUpdateCheck({ openDialogWhenAvailable: true, silent: false })
        return
      }
      setOpenPanel(action)
    }).then((stopListening) => {
      if (active) {
        unlisten = stopListening
      } else {
        stopListening()
      }
    })
    return () => {
      active = false
      unlisten?.()
    }
  }, [runUpdateCheck])

  useEffect(() => {
    if (!settingsReady || autoUpdateChecked.current || !settings.autoCheckUpdates) {
      return
    }
    autoUpdateChecked.current = true
    void runUpdateCheck({ openDialogWhenAvailable: true, silent: true })
  }, [runUpdateCheck, settings.autoCheckUpdates, settingsReady])

  useEffect(() => {
    let active = true
    const unlisteners: Array<() => void> = []
    void listenForBrowserState((state) => setBrowserMediaCount(state.candidates.length)).then(
      (stopListening) => {
        if (active) {
          unlisteners.push(stopListening)
        } else {
          stopListening()
        }
      }
    )
    void listenForBrowserMediaSelection(setBrowserSelection).then((stopListening) => {
      if (active) {
        unlisteners.push(stopListening)
      } else {
        stopListening()
      }
    })
    return () => {
      active = false
      for (const unlisten of unlisteners) {
        unlisten()
      }
    }
  }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && mediaQuery.matches)
      const root = document.documentElement
      root.classList.toggle('dark', dark)
      root.classList.toggle('light', !dark)
      root.style.colorScheme = dark ? 'dark' : 'light'
      root.style.background = dark ? '#111317' : '#ffffff'
      document.body.style.colorScheme = dark ? 'dark' : 'light'
      document.body.style.background = dark ? '#111317' : '#ffffff'
    }
    applyTheme()
    mediaQuery.addEventListener('change', applyTheme)
    return () => mediaQuery.removeEventListener('change', applyTheme)
  }, [settings.theme])

  useEffect(() => {
    if (!toastMessage) {
      return
    }
    const timeout = window.setTimeout(() => setToastMessage(''), 2400)
    return () => window.clearTimeout(timeout)
  }, [toastMessage])

  const handleSettingsChange = useCallback(
    (nextSettings: AppSettings) => {
      const revision = settingsRevision.current + 1
      settingsRevision.current = revision
      setSettings(nextSettings)
      if (nextSettings.language !== settings.language) {
        void i18n.changeLanguage(nextSettings.language)
      }
      void saveSettings(nextSettings)
        .then((saved) => {
          if (revision === settingsRevision.current) {
            setSettings(saved)
            setToastMessage(t('settings.saved'))
          }
        })
        .catch(() => {
          if (revision === settingsRevision.current) {
            setToastMessage(t('settings.saveFailed'))
          }
        })
    },
    [i18n, settings.language, t]
  )

  const handleOpenBrowser = useCallback(async () => {
    try {
      await openMediaBrowser(settings.language, settings.theme, t('browser.windowTitle'))
    } catch {
      setToastMessage(t('browser.openFailed'))
    }
  }, [settings.language, settings.theme, t])

  const handleStart = useCallback(
    async (requests: StartDownloadRequest[]) => {
      const items = await Promise.all(requests.map((request) => startDownload(request)))
      for (const item of items) {
        mergeDownload(item)
      }
    },
    [mergeDownload]
  )

  const handleQuickDownload = useCallback(
    async (url: string) => {
      const info = await probeUrl(url, undefined, 'summary')
      const commonOptions = {
        mediaType: settings.defaultMediaType,
        quality: settings.videoQuality,
        videoContainer: settings.videoContainer,
        audioFormat: settings.audioFormat,
        downloadSubtitles: settings.downloadSubtitles
      }
      // Each playlist download session needs its own instance id so a second
      // download of the same source playlist does not merge into the first group.
      const playlistInstanceId = info.isPlaylist ? crypto.randomUUID() : undefined
      const requests: StartDownloadRequest[] = info.isPlaylist
        ? info.entries.map((entry) => ({
            ...commonOptions,
            url: entry.url,
            title: entry.title,
            thumbnail: entry.thumbnail,
            duration: entry.duration,
            playlistId: playlistInstanceId,
            playlistTitle: info.title,
            playlistUrl: info.url || url
          }))
        : [
            {
              ...commonOptions,
              url: info.url,
              title: info.title,
              thumbnail: info.thumbnail,
              uploader: info.uploader,
              duration: info.duration
            }
          ]
      await handleStart(requests)
    },
    [
      handleStart,
      settings.audioFormat,
      settings.defaultMediaType,
      settings.downloadSubtitles,
      settings.videoContainer,
      settings.videoQuality
    ]
  )

  const handleRefreshPlaylist = useCallback(
    async (playlistId: string) => {
      const groupItems = downloads.filter((item) => item.playlistId === playlistId)
      const playlistUrl = groupItems.find((item) => item.playlistUrl)?.playlistUrl
      if (!playlistUrl) {
        setToastMessage(t('download.refreshPlaylistUnavailable'))
        return
      }

      const sample = groupItems[0]
      const playlistTitle =
        groupItems.find((item) => item.playlistTitle)?.playlistTitle ?? sample?.title
      const known = new Set(groupItems.map((item) => normalizeMediaUrl(item.url)))

      try {
        const info = await probeUrl(playlistUrl, undefined, 'summary')
        if (!info.isPlaylist) {
          setToastMessage(t('download.refreshPlaylistFailed'))
          return
        }

        const newEntries = info.entries.filter((entry) => !known.has(normalizeMediaUrl(entry.url)))
        if (newEntries.length === 0) {
          setToastMessage(t('download.refreshPlaylistUpToDate'))
          return
        }

        const mediaType = sample?.mediaType ?? settings.defaultMediaType
        const requests: StartDownloadRequest[] = newEntries.map((entry) => ({
          mediaType,
          quality: settings.videoQuality,
          videoContainer: settings.videoContainer,
          audioFormat: settings.audioFormat,
          downloadSubtitles: settings.downloadSubtitles,
          url: entry.url,
          title: entry.title,
          thumbnail: entry.thumbnail,
          duration: entry.duration,
          playlistId,
          playlistTitle: playlistTitle ?? info.title,
          playlistUrl
        }))
        await handleStart(requests)
        setToastMessage(t('download.refreshPlaylistAdded', { count: newEntries.length }))
      } catch {
        setToastMessage(t('download.refreshPlaylistFailed'))
      }
    },
    [
      downloads,
      handleStart,
      settings.audioFormat,
      settings.defaultMediaType,
      settings.downloadSubtitles,
      settings.videoContainer,
      settings.videoQuality,
      t
    ]
  )

  const handleCancel = useCallback(
    async (id: string) => {
      try {
        await cancelDownload(id)
      } catch {
        setToastMessage(t('download.cancelFailed'))
      }
    },
    [t]
  )

  const handlePause = useCallback(
    async (id: string) => {
      try {
        await pauseDownload(id)
      } catch {
        setToastMessage(t('download.pauseFailed'))
      }
    },
    [t]
  )

  const handleResume = useCallback(
    async (id: string) => {
      try {
        await resumeDownload(id)
      } catch {
        setToastMessage(t('download.resumeFailed'))
      }
    },
    [t]
  )

  const handleRemove = useCallback(
    async (id: string) => {
      try {
        await removeHistoryItem(id)
        setDownloads((items) => items.filter((item) => item.id !== id))
      } catch {
        setToastMessage(t('download.removeFailed'))
      }
    },
    [t]
  )

  const handleRename = useCallback(
    async (id: string, title: string) => {
      const nextTitle = title.trim()
      if (!nextTitle) {
        return
      }
      setDownloads((items) =>
        items.map((item) => (item.id === id ? { ...item, title: nextTitle } : item))
      )
      try {
        await renameDownloadTitle(id, nextTitle)
      } catch {
        setToastMessage(t('download.renameFailed'))
        try {
          const history = await getHistory()
          setDownloads(sortDownloads(history))
        } catch {
          // Keep the optimistic title when history reload also fails.
        }
      }
    },
    [t]
  )

  const handleRenamePlaylist = useCallback(
    async (playlistId: string, title: string) => {
      const nextTitle = title.trim()
      if (!nextTitle) {
        return
      }
      setDownloads((items) =>
        items.map((item) =>
          item.playlistId === playlistId ? { ...item, playlistTitle: nextTitle } : item
        )
      )
      try {
        await renamePlaylist(playlistId, nextTitle)
      } catch {
        setToastMessage(t('download.renamePlaylistFailed'))
        try {
          const history = await getHistory()
          setDownloads(sortDownloads(history))
        } catch {
          // Keep the optimistic playlist title when history reload also fails.
        }
      }
    },
    [t]
  )

  const handleClearFinished = useCallback(async () => {
    try {
      await clearFinishedHistory()
      setDownloads((items) => items.filter((item) => !isFinished(item)))
    } catch {
      setToastMessage(t('download.clearFailed'))
    }
  }, [t])

  const handleDeleteFile = useCallback(
    async (id: string) => {
      try {
        await deleteDownloadedFile(id)
        setDownloads((items) => items.filter((item) => item.id !== id))
      } catch {
        setToastMessage(t('download.deleteFailed'))
      }
    },
    [t]
  )

  const handleOpen = useCallback(
    async (path: string) => {
      try {
        await openDownloadedFile(path)
      } catch {
        setToastMessage(t('download.openFailed'))
      }
    },
    [t]
  )

  const handleOpenSource = useCallback(
    async (url: string) => {
      try {
        await openExternalUrl(url)
      } catch {
        setToastMessage(t('download.sourceOpenFailed'))
      }
    },
    [t]
  )

  const handleReveal = useCallback(
    async (path: string) => {
      try {
        await revealDownloadedFile(path)
      } catch {
        setToastMessage(t('download.revealFailed'))
      }
    },
    [t]
  )

  const handleRetry = useCallback(
    async (item: DownloadItem) => {
      try {
        const retryItem = await retryDownload(item.id)
        mergeDownload(retryItem)
      } catch {
        setToastMessage(t('download.retryFailed'))
      }
    },
    [mergeDownload, t]
  )

  return (
    <div className="app-shell">
      <TitleBar
        activePanel={openPanel}
        browserMediaCount={browserMediaCount}
        onOpenAbout={() => setOpenPanel('about')}
        onOpenBrowser={() => void handleOpenBrowser()}
        onOpenSettings={() => setOpenPanel('settings')}
        platform={runtimeInfo.platform}
        updateAvailable={Boolean(updateInfo?.updateAvailable)}
      />
      <main className="app-content">
        <DownloadPage
          browserSelection={browserSelection}
          downloads={downloads}
          onBrowserSelectionHandled={() => setBrowserSelection(null)}
          onCancel={handleCancel}
          onClearFinished={handleClearFinished}
          onDeleteFile={handleDeleteFile}
          onOpen={handleOpen}
          onOpenSource={handleOpenSource}
          onPause={handlePause}
          onQuickDownload={handleQuickDownload}
          onRefreshPlaylist={handleRefreshPlaylist}
          onRemove={handleRemove}
          onRename={handleRename}
          onRenamePlaylist={handleRenamePlaylist}
          onResume={handleResume}
          onRetry={handleRetry}
          onReveal={handleReveal}
          onStart={handleStart}
          settings={settings}
        />
      </main>
      {openPanel === 'settings' ? (
        <PanelDialog onClose={closePanel} title={t('settings.title')} variant="settings">
          <SettingsPage
            onChange={handleSettingsChange}
            platform={runtimeInfo.platform}
            settings={settings}
          />
        </PanelDialog>
      ) : null}
      {openPanel === 'about' ? (
        <PanelDialog onClose={closePanel} title={t('about.title')} variant="about">
          <AboutPage
            onCheckForUpdates={() =>
              void runUpdateCheck({ openDialogWhenAvailable: true, silent: false })
            }
            onShowUpdate={() => setUpdateDialogOpen(true)}
            runtimeInfo={runtimeInfo}
            updateChecking={updateChecking}
            updateInfo={updateInfo}
          />
        </PanelDialog>
      ) : null}
      {updateDialogOpen && updateInfo?.updateAvailable ? (
        <UpdateDialog
          info={updateInfo}
          onClose={() => setUpdateDialogOpen(false)}
          onDismiss={() => setUpdateDialogOpen(false)}
        />
      ) : null}
      {toastMessage ? (
        <div aria-live="polite" className="toast">
          {toastMessage}
        </div>
      ) : null}
    </div>
  )
}

export default App

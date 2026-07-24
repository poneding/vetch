import {
  BrushCleaning,
  Download,
  ListFilter,
  LoaderCircle,
  Plus,
  Rocket,
  SlidersHorizontal
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isDesktopRuntime, readClipboardUrl } from '../lib/backend'
import { isValidMediaUrl } from '../lib/format'
import type {
  AppSettings,
  BrowserMediaCandidate,
  DownloadItem,
  StartDownloadRequest
} from '../types'
import { AddDownloadDialog } from './AddDownloadDialog'
import { DownloadDialog } from './DownloadDialog'
import { DownloadRow } from './DownloadRow'
import { PlaylistDownloadGroup } from './PlaylistDownloadGroup'

type StatusFilter = 'all' | 'active' | 'completed' | 'error'

interface DownloadPageProps {
  browserSelection?: BrowserMediaCandidate | null
  downloads: DownloadItem[]
  settings: AppSettings
  onCancel: (id: string) => Promise<void>
  onBrowserSelectionHandled?: () => void
  onClearFinished: () => Promise<void>
  onDeleteFile: (id: string) => Promise<void>
  onOpen: (path: string) => Promise<void>
  onOpenSource: (url: string) => Promise<void>
  onPause: (id: string) => Promise<void>
  onQuickDownload: (url: string) => Promise<void>
  onRefreshPlaylist: (playlistId: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onRename: (id: string, title: string) => Promise<void>
  onRenamePlaylist: (playlistId: string, title: string) => Promise<void>
  onResume: (id: string) => Promise<void>
  onRetry: (item: DownloadItem) => Promise<void>
  onReveal: (path: string) => Promise<void>
  onStart: (requests: StartDownloadRequest[]) => Promise<void>
}

const activeStatuses = new Set(['pending', 'downloading', 'processing', 'paused'])
const DOWNLOAD_LIST_SCROLL_IDLE_MS = 900
const DOWNLOAD_LIST_SCROLLBAR_MIN_THUMB = 28

interface ClipboardActionIconProps {
  busy: boolean
  oneClickDownload: boolean
}

function ClipboardActionIcon({ busy, oneClickDownload }: ClipboardActionIconProps) {
  if (busy) {
    return <LoaderCircle className="spin" size={16} />
  }
  if (!oneClickDownload) {
    return <SlidersHorizontal size={17} />
  }
  return <Rocket size={17} />
}

type DownloadListEntry =
  | { kind: 'single'; item: DownloadItem }
  | { kind: 'playlist'; id: string; title: string; items: DownloadItem[]; allItems: DownloadItem[] }

interface OverlayScrollbarMetrics {
  canScroll: boolean
  thumbHeight: number
  thumbOffset: number
}

const hiddenOverlayScrollbar: OverlayScrollbarMetrics = {
  canScroll: false,
  thumbHeight: 0,
  thumbOffset: 0
}

function measureOverlayScrollbar(element: HTMLElement): OverlayScrollbarMetrics {
  const { clientHeight, scrollHeight, scrollTop } = element
  if (scrollHeight <= clientHeight + 1) {
    return hiddenOverlayScrollbar
  }

  const thumbHeight = Math.max(
    DOWNLOAD_LIST_SCROLLBAR_MIN_THUMB,
    (clientHeight / scrollHeight) * clientHeight
  )
  const maxOffset = Math.max(clientHeight - thumbHeight, 0)
  const maxScroll = scrollHeight - clientHeight
  const thumbOffset = maxScroll <= 0 ? 0 : (scrollTop / maxScroll) * maxOffset

  return {
    canScroll: true,
    thumbHeight,
    thumbOffset
  }
}

export function DownloadPage({
  browserSelection = null,
  downloads,
  settings,
  onCancel,
  onBrowserSelectionHandled,
  onClearFinished,
  onDeleteFile,
  onOpen,
  onOpenSource,
  onPause,
  onQuickDownload,
  onRefreshPlaylist,
  onRemove,
  onRename,
  onRenamePlaylist,
  onResume,
  onRetry,
  onReveal,
  onStart
}: DownloadPageProps) {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [clipboardHasUrl, setClipboardHasUrl] = useState(false)
  const [referer, setReferer] = useState<string | undefined>()
  const [preferredTitle, setPreferredTitle] = useState<string | undefined>()
  const [listScrolling, setListScrolling] = useState(false)
  const [scrollbarDragging, setScrollbarDragging] = useState(false)
  const [scrollbar, setScrollbar] = useState<OverlayScrollbarMetrics>(hiddenOverlayScrollbar)
  const downloadListRef = useRef<HTMLDivElement>(null)
  const downloadListContentRef = useRef<HTMLDivElement>(null)
  const listScrollIdleTimerRef = useRef<number | null>(null)
  const scrollbarDragRef = useRef<{
    pointerId: number
    startY: number
    startScrollTop: number
  } | null>(null)

  const clearScrollIdleTimer = useCallback(() => {
    if (listScrollIdleTimerRef.current !== null) {
      window.clearTimeout(listScrollIdleTimerRef.current)
      listScrollIdleTimerRef.current = null
    }
  }, [])

  const scheduleScrollIdleHide = useCallback(() => {
    clearScrollIdleTimer()
    listScrollIdleTimerRef.current = window.setTimeout(() => {
      setListScrolling(false)
      listScrollIdleTimerRef.current = null
    }, DOWNLOAD_LIST_SCROLL_IDLE_MS)
  }, [clearScrollIdleTimer])

  const updateOverlayScrollbar = useCallback(() => {
    const element = downloadListRef.current
    if (!element) {
      setScrollbar(hiddenOverlayScrollbar)
      return
    }
    setScrollbar(measureOverlayScrollbar(element))
  }, [])

  const handleDownloadListScroll = useCallback(() => {
    updateOverlayScrollbar()
    setListScrolling(true)
    if (!scrollbarDragRef.current) {
      scheduleScrollIdleHide()
    }
  }, [scheduleScrollIdleHide, updateOverlayScrollbar])

  const handleScrollbarPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const element = downloadListRef.current
      if (!(element && scrollbar.canScroll)) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      clearScrollIdleTimer()
      setListScrolling(true)
      setScrollbarDragging(true)
      scrollbarDragRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startScrollTop: element.scrollTop
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [clearScrollIdleTimer, scrollbar.canScroll]
  )

  const handleScrollbarPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = scrollbarDragRef.current
      const element = downloadListRef.current
      if (!(drag && element) || drag.pointerId !== event.pointerId) {
        return
      }

      const { clientHeight, scrollHeight } = element
      const thumbHeight = Math.max(
        DOWNLOAD_LIST_SCROLLBAR_MIN_THUMB,
        (clientHeight / scrollHeight) * clientHeight
      )
      const maxOffset = Math.max(clientHeight - thumbHeight, 0)
      const maxScroll = Math.max(scrollHeight - clientHeight, 0)
      if (maxOffset <= 0 || maxScroll <= 0) {
        return
      }

      const deltaY = event.clientY - drag.startY
      const nextScrollTop = Math.min(
        maxScroll,
        Math.max(0, drag.startScrollTop + (deltaY / maxOffset) * maxScroll)
      )
      element.scrollTop = nextScrollTop
      updateOverlayScrollbar()
    },
    [updateOverlayScrollbar]
  )

  const endScrollbarDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = scrollbarDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) {
        return
      }

      scrollbarDragRef.current = null
      setScrollbarDragging(false)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      scheduleScrollIdleHide()
    },
    [scheduleScrollIdleHide]
  )

  useEffect(() => {
    return () => {
      clearScrollIdleTimer()
    }
  }, [clearScrollIdleTimer])

  useEffect(() => {
    if (!browserSelection) {
      return
    }
    setUrl(browserSelection.url)
    setReferer(browserSelection.pageUrl || undefined)
    setPreferredTitle(browserSelection.title.trim() || undefined)
    setAddDialogOpen(false)
    setDialogOpen(true)
    setNotice('')
    onBrowserSelectionHandled?.()
  }, [browserSelection, onBrowserSelectionHandled])

  const stats = useMemo(
    () => ({
      all: downloads.length,
      active: downloads.filter((item) => activeStatuses.has(item.status)).length,
      completed: downloads.filter((item) => item.status === 'completed').length,
      error: downloads.filter((item) => item.status === 'error').length
    }),
    [downloads]
  )

  const filteredDownloads = useMemo(() => {
    return downloads.filter((item) => {
      if (statusFilter === 'active') {
        return activeStatuses.has(item.status)
      }
      if (statusFilter === 'completed' || statusFilter === 'error') {
        return item.status === statusFilter
      }
      return true
    })
  }, [downloads, statusFilter])

  const playlistItems = useMemo(() => {
    const groups = new Map<string, DownloadItem[]>()
    for (const item of downloads) {
      if (!item.playlistId) {
        continue
      }
      const group = groups.get(item.playlistId)
      if (group) {
        group.push(item)
      } else {
        groups.set(item.playlistId, [item])
      }
    }
    return groups
  }, [downloads])

  const downloadListEntries = useMemo(() => {
    const result: DownloadListEntry[] = []
    const groups = new Map<string, Extract<DownloadListEntry, { kind: 'playlist' }>>()
    for (const item of filteredDownloads) {
      if (!item.playlistId) {
        result.push({ kind: 'single', item })
        continue
      }
      const existing = groups.get(item.playlistId)
      if (existing) {
        existing.items.push(item)
        continue
      }
      const group: Extract<DownloadListEntry, { kind: 'playlist' }> = {
        kind: 'playlist',
        id: item.playlistId,
        title: item.playlistTitle || t('dialog.playlist'),
        items: [item],
        allItems: playlistItems.get(item.playlistId) ?? [item]
      }
      groups.set(item.playlistId, group)
      result.push(group)
    }
    return result
  }, [filteredDownloads, playlistItems, t])

  useEffect(() => {
    const element = downloadListRef.current
    const content = downloadListContentRef.current
    if (!element) {
      setScrollbar(hiddenOverlayScrollbar)
      setListScrolling(false)
      return
    }

    updateOverlayScrollbar()

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            updateOverlayScrollbar()
          })
    // Observe both viewport and content so expand/collapse of playlists remesures.
    resizeObserver?.observe(element)
    if (content) {
      resizeObserver?.observe(content)
    }

    return () => {
      resizeObserver?.disconnect()
    }
  }, [updateOverlayScrollbar])

  // Re-measure when the download list remounts after the empty state.
  useEffect(() => {
    if (filteredDownloads.length === 0) {
      setScrollbar(hiddenOverlayScrollbar)
      setListScrolling(false)
      return
    }
    updateOverlayScrollbar()
  }, [filteredDownloads.length, updateOverlayScrollbar])

  const validateUrl = (): boolean => {
    const valid = isValidMediaUrl(url.trim())
    setNotice(valid ? '' : t('download.invalidUrl'))
    return valid
  }

  const readValidClipboardUrl = useCallback(async (): Promise<string | null> => {
    try {
      const clipboardText = (await readClipboardUrl()).trim()
      const valid = isValidMediaUrl(clipboardText)
      setClipboardHasUrl(valid)
      return valid ? clipboardText : null
    } catch {
      setClipboardHasUrl(false)
      return null
    }
  }, [])

  const checkClipboardUrl = useCallback(async (): Promise<void> => {
    await readValidClipboardUrl()
  }, [readValidClipboardUrl])

  useEffect(() => {
    const handleWindowFocus = () => void checkClipboardUrl()
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkClipboardUrl()
      }
    }

    void checkClipboardUrl()
    window.addEventListener('focus', handleWindowFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('focus', handleWindowFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [checkClipboardUrl])

  const handlePaste = async () => {
    const clipboardUrl = await readValidClipboardUrl()
    if (!clipboardUrl) {
      setNotice(t('download.clipboardEmpty'))
      return
    }
    setUrl(clipboardUrl)
    setNotice('')
  }

  const handleDownloadNow = async () => {
    if (!validateUrl()) {
      return
    }
    if (!isDesktopRuntime()) {
      setNotice(t('download.backendRequired'))
      return
    }
    setBusy(true)
    try {
      await onQuickDownload(url.trim())
      setUrl('')
      setAddDialogOpen(false)
      setNotice('')
    } catch (downloadError) {
      setNotice(downloadError instanceof Error ? downloadError.message : t('download.startFailed'))
    } finally {
      setBusy(false)
    }
  }

  const handleOpenOptions = () => {
    if (!validateUrl()) {
      return
    }
    if (!isDesktopRuntime()) {
      setNotice(t('download.backendRequired'))
      return
    }
    setAddDialogOpen(false)
    setDialogOpen(true)
  }

  const handleOpenAddDialog = async () => {
    setNotice('')
    setUrl('')
    setReferer(undefined)
    setPreferredTitle(undefined)
    setAddDialogOpen(true)
    setUrl((await readValidClipboardUrl()) ?? '')
  }

  const handleQuickClipboardDownload = async () => {
    const clipboardUrl = await readValidClipboardUrl()
    if (!clipboardUrl) {
      setNotice(t('download.clipboardEmpty'))
      return
    }
    if (!isDesktopRuntime()) {
      setNotice(t('download.backendRequired'))
      return
    }
    setNotice('')
    if (!settings.oneClickDownload) {
      setUrl(clipboardUrl)
      setReferer(undefined)
      setDialogOpen(true)
      return
    }
    setBusy(true)
    try {
      await onQuickDownload(clipboardUrl)
    } catch (downloadError) {
      setNotice(downloadError instanceof Error ? downloadError.message : t('download.startFailed'))
    } finally {
      setBusy(false)
    }
  }

  const handleStart = async (requests: StartDownloadRequest[]) => {
    await onStart(requests)
    setUrl('')
    setNotice('')
  }

  const filters: Array<{ key: StatusFilter; label: string; count: number }> = [
    { key: 'all', label: t('download.all'), count: stats.all },
    { key: 'active', label: t('download.active'), count: stats.active },
    { key: 'completed', label: t('download.completed'), count: stats.completed },
    { key: 'error', label: t('download.error'), count: stats.error }
  ]
  const hasFinishedItems = downloads.some((item) => !activeStatuses.has(item.status))
  const defaultMediaTypeLabel = t(`common.${settings.defaultMediaType}`)
  const clipboardActionLabel = settings.oneClickDownload
    ? t('download.quickClipboardAs', { mediaType: defaultMediaTypeLabel })
    : t('download.configureClipboard')
  const showOverlayScrollbar = scrollbar.canScroll && (listScrolling || scrollbarDragging)

  return (
    <div className="page download-page">
      <section className="queue-panel">
        <div className="queue-header">
          <h2>{t('download.queue')}</h2>
          <div className="queue-header-actions" onPointerEnter={() => void checkClipboardUrl()}>
            <button
              aria-label={clipboardActionLabel}
              className={
                clipboardHasUrl
                  ? 'icon-button queue-quick-button is-ready'
                  : 'icon-button queue-quick-button'
              }
              data-clipboard-url={clipboardHasUrl ? 'true' : 'false'}
              disabled={!clipboardHasUrl || busy}
              onClick={() => void handleQuickClipboardDownload()}
              onFocus={() => void checkClipboardUrl()}
              title={clipboardActionLabel}
              type="button"
            >
              <ClipboardActionIcon busy={busy} oneClickDownload={settings.oneClickDownload} />
            </button>
            <button
              aria-label={t('download.addDownload')}
              className="queue-add-button"
              disabled={busy}
              onClick={() => void handleOpenAddDialog()}
              title={t('download.addDownload')}
              type="button"
            >
              <Plus size={18} strokeWidth={2.4} />
            </button>
          </div>
        </div>
        <div className="filter-bar">
          <ListFilter aria-hidden="true" size={16} />
          {filters.map((filter) => (
            <button
              aria-pressed={statusFilter === filter.key}
              className="filter-button"
              key={filter.key}
              onClick={() => setStatusFilter(filter.key)}
              type="button"
            >
              {filter.label}
              <span>{filter.count}</span>
            </button>
          ))}
          {hasFinishedItems ? (
            <button
              className="clear-finished-button quiet-button"
              onClick={onClearFinished}
              type="button"
            >
              <BrushCleaning size={15} />
              {t('download.clearFinished')}
            </button>
          ) : null}
        </div>
        {notice && !addDialogOpen ? (
          <div aria-live="polite" className="queue-notice">
            {notice}
          </div>
        ) : null}

        {filteredDownloads.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Download size={25} />
            </div>
            <h3>{t('download.emptyTitle')}</h3>
            <p>{t('download.emptyDescription')}</p>
          </div>
        ) : (
          <div className="download-list-shell">
            <div
              className={showOverlayScrollbar ? 'download-list is-scrolling' : 'download-list'}
              onScroll={handleDownloadListScroll}
              ref={downloadListRef}
            >
              <div className="download-list-content" ref={downloadListContentRef}>
                {downloadListEntries.map((entry) =>
                  entry.kind === 'playlist' ? (
                    <PlaylistDownloadGroup
                      allItems={entry.allItems}
                      items={entry.items}
                      key={entry.id}
                      onCancel={onCancel}
                      onDeleteFile={onDeleteFile}
                      onOpen={onOpen}
                      onOpenSource={onOpenSource}
                      onPause={onPause}
                      onRefreshPlaylist={onRefreshPlaylist}
                      onRemove={onRemove}
                      onRename={onRename}
                      onRenamePlaylist={onRenamePlaylist}
                      onResume={onResume}
                      onRetry={onRetry}
                      onReveal={onReveal}
                      playlistId={entry.id}
                      title={entry.title}
                    />
                  ) : (
                    <DownloadRow
                      item={entry.item}
                      key={entry.item.id}
                      onCancel={onCancel}
                      onDeleteFile={onDeleteFile}
                      onOpen={onOpen}
                      onOpenSource={onOpenSource}
                      onPause={onPause}
                      onRemove={onRemove}
                      onRename={onRename}
                      onResume={onResume}
                      onRetry={onRetry}
                      onReveal={onReveal}
                    />
                  )
                )}
              </div>
            </div>
            {scrollbar.canScroll ? (
              <div
                aria-hidden="true"
                className={
                  showOverlayScrollbar
                    ? 'download-list-scrollbar is-visible'
                    : 'download-list-scrollbar'
                }
              >
                <div
                  className={
                    scrollbarDragging
                      ? 'download-list-scrollbar-thumb is-dragging'
                      : 'download-list-scrollbar-thumb'
                  }
                  onPointerCancel={endScrollbarDrag}
                  onPointerDown={handleScrollbarPointerDown}
                  onPointerMove={handleScrollbarPointerMove}
                  onPointerUp={endScrollbarDrag}
                  style={{
                    height: `${scrollbar.thumbHeight}px`,
                    transform: `translateY(${scrollbar.thumbOffset}px)`
                  }}
                />
              </div>
            ) : null}
          </div>
        )}
      </section>

      <AddDownloadDialog
        busy={busy}
        clipboardHasUrl={clipboardHasUrl}
        notice={notice}
        onChange={(nextUrl) => {
          setUrl(nextUrl)
          setReferer(undefined)
          setPreferredTitle(undefined)
          setNotice('')
        }}
        onClose={() => {
          setAddDialogOpen(false)
          setNotice('')
        }}
        onConfigure={handleOpenOptions}
        onDownload={() => void handleDownloadNow()}
        oneClickDownload={settings.oneClickDownload}
        onPaste={() => void handlePaste()}
        open={addDialogOpen}
        url={url}
      />

      <DownloadDialog
        onClose={() => {
          setDialogOpen(false)
          setPreferredTitle(undefined)
        }}
        onStart={handleStart}
        open={dialogOpen}
        preferredTitle={preferredTitle}
        referer={referer}
        settings={settings}
        url={url.trim()}
      />
    </div>
  )
}

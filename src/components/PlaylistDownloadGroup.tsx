import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileX2,
  FolderOpen,
  ListVideo,
  LoaderCircle,
  RefreshCw,
  Trash2
} from 'lucide-react'
import { type MouseEvent, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parentDirectory, sourceLabel } from '../lib/format'
import type { DownloadItem } from '../types'
import { ConfirmationDialog } from './ConfirmationDialog'
import { DownloadRow } from './DownloadRow'
import { EditableTitle } from './EditableTitle'

interface PlaylistDownloadGroupProps {
  allItems: DownloadItem[]
  items: DownloadItem[]
  playlistId: string
  title: string
  onCancel: (id: string) => Promise<void>
  onDeleteFile: (id: string) => Promise<void>
  onOpen: (path: string) => Promise<void>
  onOpenSource: (url: string) => Promise<void>
  onPause: (id: string) => Promise<void>
  onRefreshPlaylist: (playlistId: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onRename: (id: string, title: string) => Promise<void>
  onRenamePlaylist: (playlistId: string, title: string) => Promise<void>
  onResume: (id: string) => Promise<void>
  onRetry: (item: DownloadItem) => Promise<void>
  onReveal: (path: string) => Promise<void>
}

const activeStatuses = new Set(['pending', 'downloading', 'processing', 'paused'])

type ConfirmAction = 'delete' | 'remove' | null

export function PlaylistDownloadGroup({
  allItems,
  items,
  playlistId,
  title,
  onCancel,
  onDeleteFile,
  onOpen,
  onOpenSource,
  onPause,
  onRefreshPlaylist,
  onRemove,
  onRename,
  onRenamePlaylist,
  onResume,
  onRetry,
  onReveal
}: PlaylistDownloadGroupProps) {
  const { t } = useTranslation()
  const activeCount = items.filter((item) => activeStatuses.has(item.status)).length
  const playlistRenameDisabled = allItems.some((item) => activeStatuses.has(item.status))
  const playlistUrl = allItems.find((item) => item.playlistUrl)?.playlistUrl
  const canRefreshPlaylist = Boolean(playlistUrl)
  const inProgressCount = items.filter(
    (item) =>
      item.status === 'pending' || item.status === 'downloading' || item.status === 'processing'
  ).length
  const completedCount = items.filter((item) => item.status === 'completed').length
  const errorCount = items.filter((item) => item.status === 'error').length
  const pausedCount = items.filter((item) => item.status === 'paused').length
  const cancelledCount = items.filter((item) => item.status === 'cancelled').length
  const downloadableItems = allItems.filter(
    (item) => item.status === 'completed' && Boolean(item.filePath)
  )
  const removableItems = allItems.filter((item) => !activeStatuses.has(item.status))
  const folderPath =
    downloadableItems[0]?.downloadDirectory ??
    (downloadableItems[0]?.filePath
      ? parentDirectory(downloadableItems[0].filePath as string)
      : undefined)
  const canRemovePlaylist = allItems.length > 0 && removableItems.length === allItems.length
  const source = useMemo(() => {
    const sample = items[0] ?? allItems[0]
    if (!sample?.url) {
      return null
    }
    return {
      label: sourceLabel(sample.url),
      url: sample.url
    }
  }, [allItems, items])
  const [expanded, setExpanded] = useState(activeCount > 0)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const toggleLabel = expanded ? t('download.collapsePlaylist') : t('download.expandPlaylist')
  const statusSummary = useMemo(() => {
    const parts: Array<{ key: string; label: string; tone?: 'danger' }> = []
    if (completedCount > 0) {
      parts.push({
        key: 'completed',
        label: t('download.playlistCompleted', { count: completedCount })
      })
    }
    if (inProgressCount > 0) {
      parts.push({
        key: 'active',
        label: t('download.playlistActive', { count: inProgressCount })
      })
    }
    if (pausedCount > 0) {
      parts.push({
        key: 'paused',
        label: t('download.playlistPaused', { count: pausedCount })
      })
    }
    if (errorCount > 0) {
      parts.push({
        key: 'error',
        label: t('download.playlistErrors', { count: errorCount }),
        tone: 'danger'
      })
    }
    if (cancelledCount > 0) {
      parts.push({
        key: 'cancelled',
        label: t('download.playlistCancelled', { count: cancelledCount })
      })
    }
    return parts
  }, [cancelledCount, completedCount, errorCount, inProgressCount, pausedCount, t])

  useEffect(() => {
    if (activeCount > 0) {
      setExpanded(true)
    }
  }, [activeCount])

  const handleBatchAction = async (action: Exclude<ConfirmAction, null>): Promise<void> => {
    setBusy(true)
    try {
      if (action === 'delete') {
        await Promise.all(downloadableItems.map((item) => onDeleteFile(item.id)))
      } else {
        await Promise.all(removableItems.map((item) => onRemove(item.id)))
      }
      setConfirmAction(null)
    } finally {
      setBusy(false)
    }
  }

  const handleRefreshPlaylist = async (): Promise<void> => {
    if (!canRefreshPlaylist || refreshing || busy) {
      return
    }
    setRefreshing(true)
    try {
      await onRefreshPlaylist(playlistId)
    } finally {
      setRefreshing(false)
    }
  }

  const toggleExpanded = (): void => {
    if (busy) {
      return
    }
    setExpanded((current) => !current)
  }

  const handleHeaderDoubleClick = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target
    if (!(target instanceof Element)) {
      return
    }
    if (target.closest('a, button, input, textarea')) {
      return
    }
    toggleExpanded()
  }

  return (
    <section className="playlist-group">
      {/* Double-click expands as progressive enhancement; keyboard users use the expand icon button. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: row double-click is supplementary to the expand button */}
      <div
        className={expanded ? 'playlist-group-header is-expanded' : 'playlist-group-header'}
        onDoubleClick={handleHeaderDoubleClick}
      >
        <span aria-hidden="true" className="playlist-group-icon">
          <ListVideo size={24} />
        </span>
        <div className="playlist-group-main">
          <div className="playlist-group-title-line">
            <span className="playlist-group-copy">
              <EditableTitle
                as="strong"
                disabled={playlistRenameDisabled}
                onSave={(nextTitle) => onRenamePlaylist(playlistId, nextTitle)}
                title={title}
              />
            </span>
            <div className="playlist-group-actions">
              <button
                aria-expanded={expanded}
                aria-label={toggleLabel}
                className="icon-button"
                disabled={busy || refreshing}
                onClick={toggleExpanded}
                title={toggleLabel}
                type="button"
              >
                {expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
              </button>
              {canRefreshPlaylist ? (
                <button
                  aria-label={t('download.refreshPlaylist')}
                  className="icon-button"
                  disabled={busy || refreshing}
                  onClick={() => void handleRefreshPlaylist()}
                  title={t('download.refreshPlaylist')}
                  type="button"
                >
                  {refreshing ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <RefreshCw size={16} />
                  )}
                </button>
              ) : null}
              {folderPath ? (
                <button
                  aria-label={t('download.openPlaylistFolder')}
                  className="icon-button"
                  disabled={busy}
                  onClick={() => void onReveal(folderPath)}
                  title={t('download.openPlaylistFolder')}
                  type="button"
                >
                  <FolderOpen size={16} />
                </button>
              ) : null}
              {downloadableItems.length > 0 ? (
                <button
                  aria-label={t('download.deletePlaylistFiles')}
                  className="icon-button destructive-icon-button"
                  disabled={busy}
                  onClick={() => setConfirmAction('delete')}
                  title={t('download.deletePlaylistFiles')}
                  type="button"
                >
                  <FileX2 size={16} />
                </button>
              ) : null}
              {canRemovePlaylist ? (
                <button
                  aria-label={t('download.removePlaylist')}
                  className="icon-button destructive-icon-button"
                  disabled={busy}
                  onClick={() => setConfirmAction('remove')}
                  title={t('download.removePlaylist')}
                  type="button"
                >
                  <Trash2 size={16} />
                </button>
              ) : null}
            </div>
          </div>
          <div className="playlist-group-meta-block">
            <div className="playlist-group-meta">
              {source ? (
                <a
                  className="download-source-link playlist-group-source"
                  href={source.url}
                  onClick={(event) => {
                    event.preventDefault()
                    void onOpenSource(source.url)
                  }}
                  rel="noopener noreferrer"
                  target="_blank"
                  title={t('download.openSource')}
                >
                  {source.label}
                  <ExternalLink size={10} />
                </a>
              ) : null}
              <span>{t('download.playlistItems', { count: items.length })}</span>
              {statusSummary.map((part) => (
                <span className={part.tone === 'danger' ? 'danger' : undefined} key={part.key}>
                  {part.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      {confirmAction ? (
        <ConfirmationDialog
          cancelLabel={confirmAction === 'delete' ? t('download.keepFile') : t('dialog.cancel')}
          confirmLabel={
            confirmAction === 'delete' ? t('download.deletePermanently') : t('download.remove')
          }
          description={
            confirmAction === 'delete'
              ? t('download.deletePlaylistFilesConfirm')
              : t('download.removePlaylistConfirm')
          }
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => handleBatchAction(confirmAction)}
          title={
            confirmAction === 'delete'
              ? t('download.deletePlaylistFiles')
              : t('download.removePlaylist')
          }
        />
      ) : null}
      {expanded ? (
        <div className="playlist-group-items">
          {items.map((item) => (
            <DownloadRow
              hidePlaylistName
              item={item}
              key={item.id}
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
          ))}
        </div>
      ) : null}
    </section>
  )
}

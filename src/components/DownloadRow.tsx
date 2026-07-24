import {
  AlertCircle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleEllipsis,
  ExternalLink,
  FilePlay,
  FileX2,
  FolderOpen,
  LoaderCircle,
  Pause,
  PauseCircle,
  Play,
  RotateCcw,
  Trash2,
  X
} from 'lucide-react'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  displayFileName,
  formatBytes,
  formatDate,
  formatDuration,
  sourceLabel
} from '../lib/format'
import type { DownloadItem } from '../types'
import { ConfirmationDialog } from './ConfirmationDialog'
import { EditableTitle } from './EditableTitle'
import { MediaThumbnail } from './MediaThumbnail'

interface DownloadRowProps {
  hidePlaylistName?: boolean
  item: DownloadItem
  onCancel: (id: string) => Promise<void>
  onDeleteFile: (id: string) => Promise<void>
  onOpen: (path: string) => Promise<void>
  onOpenSource: (url: string) => Promise<void>
  onPause: (id: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onRename: (id: string, title: string) => Promise<void>
  onResume: (id: string) => Promise<void>
  onRetry: (item: DownloadItem) => Promise<void>
  onReveal: (path: string) => Promise<void>
}

const activeStatuses = new Set(['pending', 'downloading', 'processing'])

interface StatusIconProps {
  status: DownloadItem['status']
}

function StatusIcon({ status }: StatusIconProps) {
  if (status === 'completed') {
    return <CheckCircle2 className="status-icon success" size={15} />
  }
  if (status === 'error') {
    return <AlertCircle className="status-icon danger" size={15} />
  }
  if (status === 'cancelled') {
    return <Ban className="status-icon muted" size={15} />
  }
  if (status === 'pending') {
    return <CircleEllipsis className="status-icon pending" size={15} />
  }
  if (status === 'paused') {
    return <PauseCircle className="status-icon muted" size={15} />
  }
  return <LoaderCircle className="status-icon spin" size={15} />
}

export const DownloadRow = memo(function DownloadRow({
  hidePlaylistName = false,
  item,
  onCancel,
  onDeleteFile,
  onOpen,
  onOpenSource,
  onPause,
  onRemove,
  onRename,
  onResume,
  onRetry,
  onReveal
}: DownloadRowProps) {
  const { t } = useTranslation()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const isActive = activeStatuses.has(item.status)
  const isPaused = item.status === 'paused'
  const isCompleted = item.status === 'completed'
  const progressPercent = Math.min(100, Math.max(0, item.progress.percent))
  const statusLabel =
    isActive || isPaused
      ? `${t(`download.${item.status}`)}[${progressPercent.toFixed(0)}%]`
      : t(`download.${item.status}`)

  return (
    <article className="download-row">
      <div className="download-row-main">
        <div className="download-thumbnail">
          <MediaThumbnail height={62} src={item.thumbnail} width={100}>
            <FilePlay size={24} />
          </MediaThumbnail>
        </div>
        <div className="download-content">
          <div className="download-title-line">
            <span className="download-title-copy">
              <EditableTitle
                onSave={(nextTitle) => onRename(item.id, nextTitle)}
                title={displayFileName(item)}
              />
            </span>
            <div className="download-actions">
              <button
                aria-expanded={detailsOpen}
                aria-label={t('download.details')}
                className="icon-button"
                onClick={() => setDetailsOpen((current) => !current)}
                title={t('download.details')}
                type="button"
              >
                {detailsOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
              </button>
              {isCompleted && item.filePath ? (
                <>
                  <button
                    aria-label={t('download.openFile')}
                    className="icon-button"
                    onClick={() => onOpen(item.filePath as string)}
                    title={t('download.openFile')}
                    type="button"
                  >
                    <FilePlay size={16} />
                  </button>
                  <button
                    aria-label={t('download.showInFolder')}
                    className="icon-button"
                    onClick={() => onReveal(item.filePath as string)}
                    title={t('download.showInFolder')}
                    type="button"
                  >
                    <FolderOpen size={16} />
                  </button>
                  <button
                    aria-label={t('download.deleteFile')}
                    className="destructive-icon-button icon-button"
                    onClick={() => setDeleteConfirmOpen(true)}
                    title={t('download.deleteFile')}
                    type="button"
                  >
                    <FileX2 size={16} />
                  </button>
                </>
              ) : null}
              {item.status === 'downloading' || item.status === 'pending' ? (
                <button
                  aria-label={t('download.pause')}
                  className="icon-button"
                  onClick={() => onPause(item.id)}
                  title={t('download.pause')}
                  type="button"
                >
                  <Pause size={16} />
                </button>
              ) : null}
              {isPaused ? (
                <button
                  aria-label={t('download.resume')}
                  className="icon-button"
                  onClick={() => onResume(item.id)}
                  title={t('download.resume')}
                  type="button"
                >
                  <Play size={16} />
                </button>
              ) : null}
              {isActive || isPaused ? (
                <button
                  aria-label={t('download.cancel')}
                  className="icon-button"
                  onClick={() => onCancel(item.id)}
                  title={t('download.cancel')}
                  type="button"
                >
                  <X size={17} />
                </button>
              ) : null}
              {item.status === 'error' || item.status === 'cancelled' ? (
                <button
                  aria-label={t('download.retry')}
                  className="icon-button"
                  onClick={() => onRetry(item)}
                  title={t('download.retry')}
                  type="button"
                >
                  <RotateCcw size={16} />
                </button>
              ) : null}
              {isActive || isPaused ? null : (
                <button
                  aria-label={t('download.remove')}
                  className="icon-button destructive-icon-button"
                  onClick={() => onRemove(item.id)}
                  title={t('download.remove')}
                  type="button"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>
          <div className="download-meta-block">
            <div className="download-meta">
              <span className={`status-text status-${item.status}`}>
                <StatusIcon status={item.status} />
                {statusLabel}
              </span>
              <a
                className="download-source-link"
                href={item.url}
                onClick={(event) => {
                  event.preventDefault()
                  void onOpenSource(item.url)
                }}
                rel="noopener noreferrer"
                target="_blank"
                title={t('download.openSource')}
              >
                {sourceLabel(item.url)}
                <ExternalLink size={10} />
              </a>
              {!hidePlaylistName && item.playlistTitle ? (
                <span className="playlist-name">{item.playlistTitle}</span>
              ) : null}
              {item.uploader ? <span className="download-owner">{item.uploader}</span> : null}
              {item.duration ? <span>{formatDuration(item.duration)}</span> : null}
              <span className="media-badge">{t(`common.${item.mediaType}`)}</span>
            </div>
          </div>
          {isActive || isPaused ? (
            <div className="progress-block">
              <div className="progress-track">
                <div className="progress-value" style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="progress-labels">
                {item.progress.speed ? <span>{item.progress.speed}</span> : null}
                {item.progress.eta ? <span>ETA {item.progress.eta}</span> : null}
                {item.progress.totalBytes ? (
                  <span>
                    {formatBytes(item.progress.downloadedBytes)} /{' '}
                    {formatBytes(item.progress.totalBytes)}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
          {item.error ? <p className="download-error-message">{item.error}</p> : null}
        </div>
      </div>
      {detailsOpen ? (
        <div className="download-details">
          <dl>
            <div>
              <dt>{t('download.source')}</dt>
              <dd>
                <a
                  className="download-detail-link"
                  href={item.url}
                  onClick={(event) => {
                    event.preventDefault()
                    void onOpenSource(item.url)
                  }}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {item.url}
                  <ExternalLink size={11} />
                </a>
              </dd>
            </div>
            <div>
              <dt>{t('download.created')}</dt>
              <dd>{formatDate(item.createdAt)}</dd>
            </div>
            {item.filePath ? (
              <div>
                <dt>{t('download.savedFile')}</dt>
                <dd>{item.filePath}</dd>
              </div>
            ) : null}
          </dl>
          <div className="log-heading">{t('download.logs')}</div>
          <pre>{item.log || '—'}</pre>
        </div>
      ) : null}
      {deleteConfirmOpen && item.filePath ? (
        <ConfirmationDialog
          cancelLabel={t('download.keepFile')}
          confirmLabel={t('download.deletePermanently')}
          description={t('download.deleteFileConfirm')}
          onCancel={() => setDeleteConfirmOpen(false)}
          onConfirm={async () => {
            await onDeleteFile(item.id)
            setDeleteConfirmOpen(false)
          }}
          title={t('download.deleteFile')}
        />
      ) : null}
    </article>
  )
})

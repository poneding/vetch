import { Clipboard, Download, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

interface DownloadActionIconProps {
  oneClickDownload: boolean
}

function DownloadActionIcon({ oneClickDownload }: DownloadActionIconProps) {
  if (!oneClickDownload) {
    return <SlidersHorizontal size={16} />
  }
  return <Download size={16} />
}

interface AddDownloadDialogProps {
  busy: boolean
  clipboardHasUrl: boolean
  notice: string
  oneClickDownload: boolean
  onChange: (url: string) => void
  onClose: () => void
  onConfigure: () => void
  onDownload: () => void
  onPaste: () => void
  open: boolean
  url: string
}

export function AddDownloadDialog({
  busy,
  clipboardHasUrl,
  notice,
  oneClickDownload,
  onChange,
  onClose,
  onConfigure,
  onDownload,
  onPaste,
  open,
  url
}: AddDownloadDialogProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    inputRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [busy, onClose, open])

  if (!open) {
    return null
  }

  return (
    <div
      aria-labelledby="add-download-dialog-title"
      aria-modal="true"
      className="modal-backdrop"
      role="dialog"
    >
      <form
        className="add-download-dialog"
        onSubmit={(event) => {
          event.preventDefault()
          if (oneClickDownload) {
            onDownload()
          } else {
            onConfigure()
          }
        }}
      >
        <div className="modal-header">
          <h2 id="add-download-dialog-title">{t('download.addDownload')}</h2>
          <button
            aria-label={t('titlebar.close')}
            className="dialog-close-button icon-button"
            disabled={busy}
            onClick={onClose}
            title={t('titlebar.close')}
            type="button"
          >
            <X size={17} />
          </button>
        </div>
        <div className="add-download-content">
          <label className="add-download-label field" htmlFor="add-download-url">
            <span>{t('download.enterUrl')}</span>
          </label>
          <div className="url-input-shell">
            <input
              aria-describedby={notice ? 'add-download-notice' : undefined}
              autoCapitalize="none"
              autoComplete="off"
              className="url-input"
              id="add-download-url"
              onChange={(event) => onChange(event.target.value)}
              placeholder={t('download.placeholder')}
              ref={inputRef}
              spellCheck={false}
              value={url}
            />
            <button
              aria-label={t('download.paste')}
              className={clipboardHasUrl ? 'url-paste-button is-ready' : 'url-paste-button'}
              data-clipboard-url={clipboardHasUrl ? 'true' : 'false'}
              onClick={onPaste}
              title={t('download.paste')}
              type="button"
            >
              <Clipboard size={16} />
            </button>
          </div>
          {notice ? (
            <div aria-live="polite" className="url-notice" id="add-download-notice">
              {notice}
            </div>
          ) : null}
        </div>
        <div className="add-download-footer modal-footer">
          <button className="secondary-button" disabled={busy} onClick={onClose} type="button">
            {t('dialog.cancel')}
          </button>
          {oneClickDownload ? (
            <button
              className="secondary-button icon-text-button"
              disabled={busy}
              onClick={onConfigure}
              type="button"
            >
              <SlidersHorizontal size={16} />
              {t('download.configureDownload')}
            </button>
          ) : null}
          <button className="primary-button" disabled={busy} type="submit">
            <DownloadActionIcon oneClickDownload={oneClickDownload} />
            {oneClickDownload ? t('download.downloadNow') : t('download.configureDownload')}
          </button>
        </div>
      </form>
    </div>
  )
}

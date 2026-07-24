import { ArrowDownToLine, BrushCleaning, FileAudio, FileVideo, Radio, X } from 'lucide-react'
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  browserBack,
  browserFocusAddress,
  browserForward,
  browserReload,
  clearBrowserMedia,
  getBrowserState,
  listenForBrowserState,
  selectBrowserMedia,
  setBrowserMediaPanelOpen,
  setBrowserMediaPanelWidth
} from '../lib/backend'
import { matchBrowserShortcut } from '../lib/browser-shortcuts'
import { formatBytes, formatDuration } from '../lib/format'
import type { BrowserMediaCandidate, BrowserStateSnapshot } from '../types'

const MEDIA_PANEL_MIN_WIDTH = 300
const MEDIA_PANEL_MAX_WIDTH = 480
const MEDIA_PANEL_RESIZE_STEP = 16

const emptyState: BrowserStateSnapshot = {
  candidates: [],
  loading: false,
  mediaPanelOpen: false,
  pageUrl: '',
  title: ''
}

const sourceHost = (candidate: BrowserMediaCandidate): string => {
  try {
    return new URL(candidate.url).hostname.replace(/^www\./, '')
  } catch {
    return candidate.url
  }
}

const candidateMeta = (candidate: BrowserMediaCandidate): string => {
  return [
    candidate.kind.toUpperCase(),
    sourceHost(candidate),
    formatDuration(candidate.duration),
    formatBytes(candidate.contentLength),
    candidate.mimeType
  ]
    .filter(Boolean)
    .join(' · ')
}

function CandidateIcon({ kind }: Pick<BrowserMediaCandidate, 'kind'>) {
  if (kind === 'hls' || kind === 'dash') {
    return <Radio size={17} />
  }
  if (kind === 'audio') {
    return <FileAudio size={17} />
  }
  return <FileVideo size={17} />
}

const clampPanelWidth = (width: number): number => {
  return Math.min(MEDIA_PANEL_MAX_WIDTH, Math.max(MEDIA_PANEL_MIN_WIDTH, width))
}

export function BrowserMediaPanel() {
  const { t } = useTranslation()
  const [browserState, setBrowserState] = useState(emptyState)
  const [error, setError] = useState('')
  const [panelWidth, setPanelWidth] = useState(() => clampPanelWidth(window.innerWidth))
  const dragStartRef = useRef<{ screenX: number; width: number } | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const resizeRequestRef = useRef<Promise<void> | null>(null)
  const requestedWidthRef = useRef(panelWidth)
  const browserStateRef = useRef(browserState)

  useEffect(() => {
    browserStateRef.current = browserState
  }, [browserState])

  useEffect(() => {
    const active = true
    let unlisten: (() => void) | undefined
    void getBrowserState().then((state) => {
      if (active) {
        setBrowserState(state)
      }
    })
    void listenForBrowserState(setBrowserState).then((stopListening) => {
      if (active) {
        unlisten = stopListening
      } else {
        stopListening()
      }
    })
    const handleResize = () => setPanelWidth(clampPanelWidth(window.innerWidth))
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      unlisten?.()
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const action = matchBrowserShortcut(event)
      if (!action) {
        return
      }
      const state = browserStateRef.current
      if (action === 'focusAddress') {
        event.preventDefault()
        void browserFocusAddress()
        return
      }
      if (action === 'toggleMedia') {
        event.preventDefault()
        void setBrowserMediaPanelOpen(!state.mediaPanelOpen)
        return
      }
      if (!state.pageUrl) {
        return
      }
      event.preventDefault()
      if (action === 'back') {
        void browserBack()
      } else if (action === 'forward') {
        void browserForward()
      } else {
        void browserReload()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const flushPanelWidth = () => {
    if (resizeRequestRef.current !== null) {
      return
    }
    const width = requestedWidthRef.current
    const request = setBrowserMediaPanelWidth(width)
    resizeRequestRef.current = request
    void request
      .finally(() => {
        if (resizeRequestRef.current !== request) {
          return
        }
        resizeRequestRef.current = null
        if (requestedWidthRef.current !== width) {
          flushPanelWidth()
        }
      })
      .catch(() => undefined)
  }

  const requestPanelWidth = (width: number) => {
    const nextWidth = clampPanelWidth(width)
    requestedWidthRef.current = nextWidth
    setPanelWidth(nextWidth)
    if (resizeFrameRef.current !== null) {
      return
    }
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null
      flushPanelWidth()
    })
  }

  const handleResizeStart = (event: PointerEvent<HTMLHRElement>) => {
    dragStartRef.current = { screenX: event.screenX, width: window.innerWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleResizeMove = (event: PointerEvent<HTMLHRElement>) => {
    const dragStart = dragStartRef.current
    if (!dragStart) {
      return
    }
    requestPanelWidth(dragStart.width + dragStart.screenX - event.screenX)
  }

  const handleResizeEnd = (event: PointerEvent<HTMLHRElement>) => {
    dragStartRef.current = null
    flushPanelWidth()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLHRElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }
    event.preventDefault()
    const direction = event.key === 'ArrowLeft' ? 1 : -1
    requestPanelWidth(panelWidth + direction * MEDIA_PANEL_RESIZE_STEP)
  }

  const handleSelect = async (candidate: BrowserMediaCandidate) => {
    setError('')
    try {
      await selectBrowserMedia(candidate.id)
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : t('browser.selectFailed'))
    }
  }

  return (
    <section aria-label={t('browser.detectedMedia')} className="browser-media-panel">
      <hr
        aria-label={t('browser.resizeMediaPanel')}
        aria-orientation="vertical"
        aria-valuemax={MEDIA_PANEL_MAX_WIDTH}
        aria-valuemin={MEDIA_PANEL_MIN_WIDTH}
        aria-valuenow={panelWidth}
        className="browser-media-resize-handle"
        onKeyDown={handleResizeKeyDown}
        onPointerCancel={handleResizeEnd}
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        tabIndex={0}
      />
      <div className="browser-media-panel-heading">
        <strong>{t('browser.detectedMedia')}</strong>
        <div className="browser-media-panel-actions">
          {browserState.candidates.length > 0 ? (
            <button
              className="quiet-button browser-clear-button"
              onClick={() => void clearBrowserMedia()}
              type="button"
            >
              <BrushCleaning size={14} />
              {t('browser.clear')}
            </button>
          ) : null}
          <button
            aria-label={t('browser.closeMediaPanel')}
            className="dialog-close-button icon-button"
            onClick={() => void setBrowserMediaPanelOpen(false)}
            title={t('browser.closeMediaPanel')}
            type="button"
          >
            <X size={18} />
          </button>
        </div>
      </div>
      {error ? <div className="browser-toolbar-error">{error}</div> : null}
      {browserState.candidates.length === 0 ? (
        <div className="browser-media-empty">{t('browser.noMedia')}</div>
      ) : (
        <div className="browser-media-list">
          {browserState.candidates.map((candidate) => (
            <div className="browser-media-row" key={candidate.id}>
              <div className={`browser-media-kind kind-${candidate.kind}`}>
                <CandidateIcon kind={candidate.kind} />
              </div>
              <div className="browser-media-description">
                <strong title={candidate.title || candidate.url}>
                  {candidate.title || sourceHost(candidate)}
                </strong>
                <span>{candidateMeta(candidate)}</span>
              </div>
              <button
                aria-label={t('browser.downloadCandidate', {
                  title: candidate.title || sourceHost(candidate)
                })}
                className="icon-button browser-candidate-download"
                onClick={() => void handleSelect(candidate)}
                title={t('browser.download')}
                type="button"
              >
                <ArrowDownToLine size={17} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

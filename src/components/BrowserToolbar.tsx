import { ArrowLeft, ArrowRight, Clapperboard, LoaderCircle, RefreshCw, Search } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  browserBack,
  browserForward,
  browserNavigate,
  browserReload,
  getBrowserState,
  listenForBrowserState,
  setBrowserMediaPanelOpen
} from '../lib/backend'
import {
  browserShortcutLabels,
  FOCUS_ADDRESS_EVENT,
  matchBrowserShortcut
} from '../lib/browser-shortcuts'
import type { BrowserStateSnapshot } from '../types'

const emptyState: BrowserStateSnapshot = {
  candidates: [],
  loading: false,
  mediaPanelOpen: false,
  pageUrl: '',
  title: ''
}

export function BrowserToolbar() {
  const { t } = useTranslation()
  const [browserState, setBrowserState] = useState(emptyState)
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')
  const addressInputRef = useRef<HTMLInputElement>(null)
  const browserStateRef = useRef(browserState)
  const shortcutLabels = useMemo(() => browserShortcutLabels(), [])

  useEffect(() => {
    browserStateRef.current = browserState
  }, [browserState])

  useEffect(() => {
    let active = true
    let unlisten: (() => void) | undefined
    void getBrowserState().then((state) => {
      if (active) {
        setBrowserState(state)
        setAddress(state.pageUrl)
      }
    })
    void listenForBrowserState((state) => {
      setBrowserState(state)
      if (document.activeElement?.getAttribute('aria-label') !== t('browser.address')) {
        setAddress(state.pageUrl)
      }
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
      void setBrowserMediaPanelOpen(false)
    }
  }, [t])

  const focusAddressBar = useCallback(() => {
    // Prefer the live page URL so Cmd/Ctrl+L always selects the navigated address.
    if (browserStateRef.current.pageUrl) {
      setAddress(browserStateRef.current.pageUrl)
    }
    // Wait for the controlled input value to commit before selecting.
    window.requestAnimationFrame(() => {
      const input = addressInputRef.current
      if (!input) {
        return
      }
      input.focus()
      input.select()
    })
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = matchBrowserShortcut(event)
      if (!action) {
        return
      }
      const state = browserStateRef.current
      if (action === 'focusAddress') {
        event.preventDefault()
        focusAddressBar()
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
    const handleExternalFocusAddress = () => {
      focusAddressBar()
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener(FOCUS_ADDRESS_EVENT, handleExternalFocusAddress)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener(FOCUS_ADDRESS_EVENT, handleExternalFocusAddress)
    }
  }, [focusAddressBar])

  const navigateToAddress = async (currentAddress: string) => {
    setError('')
    try {
      await browserNavigate(currentAddress)
    } catch (navigationError) {
      setError(navigationError instanceof Error ? navigationError.message : t('browser.invalidUrl'))
    }
  }

  const handleNavigate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void navigateToAddress(addressInputRef.current?.value ?? address)
  }

  const navigationDisabled = !browserState.pageUrl

  return (
    <div className="browser-toolbar-shell">
      <div className="browser-toolbar-row">
        <div className="browser-history-controls">
          <button
            aria-label={t('browser.back')}
            className="icon-button browser-control"
            disabled={navigationDisabled}
            onClick={() => void browserBack()}
            title={`${t('browser.back')} (${shortcutLabels.back})`}
            type="button"
          >
            <ArrowLeft size={17} />
          </button>
          <button
            aria-label={t('browser.forward')}
            className="icon-button browser-control"
            disabled={navigationDisabled}
            onClick={() => void browserForward()}
            title={`${t('browser.forward')} (${shortcutLabels.forward})`}
            type="button"
          >
            <ArrowRight size={17} />
          </button>
          <button
            aria-label={t('browser.reload')}
            className="icon-button browser-control"
            disabled={navigationDisabled}
            onClick={() => void browserReload()}
            title={`${t('browser.reload')} (${shortcutLabels.reload})`}
            type="button"
          >
            {browserState.loading ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <RefreshCw size={16} />
            )}
          </button>
        </div>
        <form
          className={error ? 'browser-address-form is-invalid' : 'browser-address-form'}
          onSubmit={handleNavigate}
          title={error || undefined}
        >
          <Search aria-hidden="true" size={15} />
          <input
            aria-invalid={Boolean(error)}
            aria-label={t('browser.address')}
            name="address"
            onChange={(event) => setAddress(event.target.value)}
            placeholder={t('browser.addressPlaceholder')}
            ref={addressInputRef}
            spellCheck={false}
            title={`${t('browser.address')} (${shortcutLabels.focusAddress})`}
            value={address}
          />
          <button
            aria-label={t('browser.navigate')}
            className="browser-address-submit"
            onClick={() => void navigateToAddress(addressInputRef.current?.value ?? address)}
            title={t('browser.navigate')}
            type="button"
          >
            <ArrowRight size={15} />
          </button>
        </form>
        <button
          aria-expanded={browserState.mediaPanelOpen}
          aria-label={t('browser.detectedMedia')}
          className={
            browserState.candidates.length > 0
              ? 'browser-media-button is-ready'
              : 'browser-media-button'
          }
          onClick={() => void setBrowserMediaPanelOpen(!browserState.mediaPanelOpen)}
          title={`${t('browser.detectedMedia')} (${shortcutLabels.toggleMedia})`}
          type="button"
        >
          <Clapperboard size={17} />
          <span>{browserState.candidates.length}</span>
        </button>
      </div>
    </div>
  )
}

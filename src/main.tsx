import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { BrowserMediaPanel } from './components/BrowserMediaPanel'
import { BrowserStart } from './components/BrowserStart'
import { BrowserToolbar } from './components/BrowserToolbar'
import i18n from './i18n'
import './styles.css'
import type { ThemeMode } from './types'

interface BrowserPreferences {
  language: 'en' | 'zh-CN'
  theme: ThemeMode
}

const BROWSER_PREFERENCES_EVENT = 'vetch-browser-preferences-changed'

const isThemeMode = (value: string | null): value is ThemeMode => {
  return value === 'light' || value === 'dark' || value === 'system'
}

const applyBrowserTheme = (theme: ThemeMode, systemDark: boolean): void => {
  const dark = theme === 'dark' || (theme === 'system' && systemDark)
  const root = document.documentElement
  const view = new URLSearchParams(window.location.search).get('view') || ''
  const pageBackground = dark ? '#111317' : '#ffffff'
  const surfaceBackground = dark ? '#181b20' : '#f7f8fa'
  const mediaBackground = dark ? '#28232f' : '#faf8ff'
  let background = pageBackground
  if (view === 'browser-toolbar') {
    background = surfaceBackground
  } else if (view === 'browser-media-panel') {
    background = mediaBackground
  }
  root.classList.toggle('dark', dark)
  root.classList.toggle('light', !dark)
  if (view) {
    root.setAttribute('data-view', view)
  }
  root.style.colorScheme = dark ? 'dark' : 'light'
  root.style.background = background
  document.body.style.colorScheme = dark ? 'dark' : 'light'
  document.body.style.background = background
}

const searchParams = new URLSearchParams(window.location.search)
const view = searchParams.get('view')
const language = searchParams.get('lang')
const theme = searchParams.get('theme')
const isBrowserChrome = view === 'browser-toolbar' || view === 'browser-media-panel'

if (isBrowserChrome || view === 'browser-start') {
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
  let browserTheme: ThemeMode = isThemeMode(theme) ? theme : 'system'

  if (language === 'en' || language === 'zh-CN') {
    void i18n.changeLanguage(language)
  }
  applyBrowserTheme(browserTheme, systemTheme.matches)

  systemTheme.addEventListener('change', (event) => {
    applyBrowserTheme(browserTheme, event.matches)
  })
  if (isBrowserChrome) {
    window.addEventListener(BROWSER_PREFERENCES_EVENT, (event) => {
      const preferences = (event as CustomEvent<BrowserPreferences>).detail
      if (!(preferences && isThemeMode(preferences.theme))) {
        return
      }
      browserTheme = preferences.theme
      void i18n.changeLanguage(preferences.language)
      applyBrowserTheme(browserTheme, systemTheme.matches)
    })
  }
}

const content =
  view === 'browser-toolbar' ? (
    <BrowserToolbar />
  ) : view === 'browser-media-panel' ? (
    <BrowserMediaPanel />
  ) : view === 'browser-start' ? (
    <BrowserStart />
  ) : (
    <App />
  )

ReactDOM.createRoot(document.querySelector('#root') as HTMLElement).render(
  <React.StrictMode>{content}</React.StrictMode>
)

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'

interface DetectorReport {
  isPlaying?: boolean
  kind?: string
  pageCandidate?: boolean
  source?: string
  url?: string
}

interface DetectorWindow extends Window {
  __VETCH_DRAIN_MEDIA__?: () => DetectorReport[]
  __VETCH_MEDIA_DETECTOR__?: boolean
  KeyboardEvent: typeof KeyboardEvent
  XMLHttpRequest: typeof XMLHttpRequest
  URL: typeof URL
}

const detectorSource = readFileSync(resolve('src-tauri/src/browser_detector.js'), 'utf8')

describe('browser media detector', () => {
  it('does not initialize on a Cloudflare challenge page', () => {
    const dom = new JSDOM(
      '<!doctype html><script src="/cdn-cgi/challenge-platform/orchestrate/chl_page/v1"></script>',
      {
        runScripts: 'outside-only',
        url: 'https://example.com/protected'
      }
    )
    const detectorWindow = dom.window as unknown as DetectorWindow

    runInContext(detectorSource, dom.getInternalVMContext())

    expect(detectorWindow.__VETCH_MEDIA_DETECTOR__).toBeUndefined()
    expect(detectorWindow.__VETCH_DRAIN_MEDIA__).toBeUndefined()
    dom.window.close()
  })

  it('leaves native browser APIs untouched', () => {
    const dom = new JSDOM('<!doctype html>', {
      runScripts: 'outside-only',
      url: 'https://example.com/watch/123'
    })
    const detectorWindow = dom.window as unknown as DetectorWindow
    const originalFetch = () => Promise.resolve()
    const originalCreateObjectUrl = () => 'blob:https://example.com/media'
    const originalXhrOpen = detectorWindow.XMLHttpRequest.prototype.open
    const originalXhrSend = detectorWindow.XMLHttpRequest.prototype.send
    const originalPushState = detectorWindow.history.pushState
    const originalReplaceState = detectorWindow.history.replaceState

    Object.defineProperty(detectorWindow, 'fetch', { value: originalFetch, writable: true })
    Object.defineProperty(detectorWindow.URL, 'createObjectURL', {
      configurable: true,
      value: originalCreateObjectUrl,
      writable: true
    })
    Object.defineProperty(detectorWindow.performance, 'getEntriesByType', {
      value: () => []
    })

    runInContext(detectorSource, dom.getInternalVMContext())

    expect(detectorWindow.fetch).toBe(originalFetch)
    expect(detectorWindow.XMLHttpRequest.prototype.open).toBe(originalXhrOpen)
    expect(detectorWindow.XMLHttpRequest.prototype.send).toBe(originalXhrSend)
    expect(detectorWindow.URL.createObjectURL).toBe(originalCreateObjectUrl)
    expect(detectorWindow.history.pushState).toBe(originalPushState)
    expect(detectorWindow.history.replaceState).toBe(originalReplaceState)
    dom.window.close()
  })

  it('does not toggle media from editable controls or contenteditable descendants', () => {
    const dom = new JSDOM(
      '<!doctype html><input><div contenteditable="true"><span>Editable</span></div>',
      {
        runScripts: 'outside-only',
        url: 'https://example.com/watch/123'
      }
    )
    const detectorWindow = dom.window as unknown as DetectorWindow
    const input = detectorWindow.document.querySelector('input')
    const editorChild = detectorWindow.document.querySelector('span')
    const openWindow = vi.fn()

    Object.defineProperty(detectorWindow.performance, 'getEntriesByType', {
      value: () => []
    })
    Object.defineProperty(detectorWindow, 'open', { value: openWindow })
    runInContext(detectorSource, dom.getInternalVMContext())

    input?.dispatchEvent(
      new detectorWindow.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'b'
      })
    )
    editorChild?.dispatchEvent(
      new detectorWindow.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'b'
      })
    )
    expect(openWindow).not.toHaveBeenCalled()

    input?.dispatchEvent(
      new detectorWindow.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'l'
      })
    )
    expect(openWindow).toHaveBeenCalledWith('vetch://focus-address')

    detectorWindow.document.body.dispatchEvent(
      new detectorWindow.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'b'
      })
    )
    expect(openWindow).toHaveBeenLastCalledWith('vetch://toggle-media')
    dom.window.close()
  })

  it('reports the page when a blob-backed video is playing', () => {
    const dom = new JSDOM('<!doctype html><video></video>', {
      runScripts: 'outside-only',
      url: 'https://example.com/watch/123'
    })
    const detectorWindow = dom.window as unknown as DetectorWindow
    const video = detectorWindow.document.querySelector('video')

    Object.defineProperties(video, {
      currentSrc: { value: 'blob:https://example.com/media' },
      duration: { value: 120 },
      paused: { value: false }
    })
    Object.defineProperty(detectorWindow.performance, 'getEntriesByType', {
      value: () => []
    })

    runInContext(detectorSource, dom.getInternalVMContext())
    const reports = detectorWindow.__VETCH_DRAIN_MEDIA__?.() ?? []

    expect(reports).toContainEqual(
      expect.objectContaining({
        isPlaying: true,
        kind: 'video',
        pageCandidate: true,
        source: 'page:ready',
        url: 'https://example.com/watch/123'
      })
    )
    dom.window.close()
  })
})

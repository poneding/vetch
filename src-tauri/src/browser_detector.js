;(() => {
  const isCloudflareChallenge =
    location.hostname === 'challenges.cloudflare.com' ||
    typeof window._cf_chl_opt === 'object' ||
    document.querySelector(
      'script[src*="/cdn-cgi/challenge-platform/"], #challenge-running, #challenge-stage'
    ) !== null
  if (isCloudflareChallenge || window.__VETCH_MEDIA_DETECTOR__) {
    return
  }
  Object.defineProperty(window, '__VETCH_MEDIA_DETECTOR__', { value: true })

  const isEditableKeyboardTarget = (target) => {
    if (!(target instanceof HTMLElement)) {
      return false
    }
    if (
      target.isContentEditable ||
      target.closest('[contenteditable]:not([contenteditable="false"])')
    ) {
      return true
    }
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  }

  // Keep page-focus shortcuts in sync with the toolbar chrome.
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.defaultPrevented || window.top !== window) {
        return
      }
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
      const mod = event.metaKey || event.ctrlKey
      const editable = isEditableKeyboardTarget(event.target)
      let action = null
      if (mod && !event.altKey && !event.shiftKey && key === 'r') {
        action = 'reload'
      } else if (mod && !event.altKey && !event.shiftKey && key === 'l') {
        action = 'focus-address'
      } else if (mod && !event.altKey && !event.shiftKey && key === 'b' && !editable) {
        action = 'toggle-media'
      } else if (mod && !event.altKey && !event.shiftKey && key === '[') {
        action = 'back'
      } else if (mod && !event.altKey && !event.shiftKey && key === ']') {
        action = 'forward'
      } else if (!mod && event.altKey && !event.shiftKey && key === 'ArrowLeft' && !editable) {
        action = 'back'
      } else if (!mod && event.altKey && !event.shiftKey && key === 'ArrowRight' && !editable) {
        action = 'forward'
      } else if (!(mod || event.altKey || event.shiftKey) && key === 'F5') {
        action = 'reload'
      }
      if (!action) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (action === 'back') {
        history.back()
        return
      }
      if (action === 'forward') {
        history.forward()
        return
      }
      if (action === 'reload') {
        location.reload()
        return
      }
      // Bridge to the host so chrome can run without leaving the page.
      window.open(action === 'focus-address' ? 'vetch://focus-address' : 'vetch://toggle-media')
    },
    true
  )

  const mediaExtensions = /\.(?:m3u8|mpd|mp4|webm|mov|mkv|ogv|m4a|mp3|aac|ogg|opus|wav|flac)$/i
  const segmentExtensions = /\.(?:ts|m4s|cmfv|cmfa)$/i
  const reported = new Map()
  const reportQueue = []
  let lastLocation = ''

  const cleanMime = (value) =>
    String(value || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase()

  const classify = (url, mimeType, hint) => {
    let parsed
    try {
      parsed = new URL(url, location.href)
    } catch {
      return null
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || segmentExtensions.test(parsed.pathname)) {
      return null
    }
    const mime = cleanMime(mimeType)
    if (/\.m3u8$/i.test(parsed.pathname) || mime.includes('mpegurl')) {
      return 'hls'
    }
    if (/\.mpd$/i.test(parsed.pathname) || mime.includes('dash+xml')) {
      return 'dash'
    }
    if (mime.startsWith('video/') || /\.(?:mp4|webm|mov|mkv|ogv)$/i.test(parsed.pathname)) {
      return 'video'
    }
    if (
      mime.startsWith('audio/') ||
      /\.(?:m4a|mp3|aac|ogg|opus|wav|flac)$/i.test(parsed.pathname)
    ) {
      return 'audio'
    }
    if (['hls', 'dash', 'video', 'audio'].includes(hint) && mediaExtensions.test(parsed.pathname)) {
      return hint
    }
    return null
  }

  const queueReport = (report) => {
    if (window.top !== window) {
      window.top.postMessage({ __vetchMediaCandidate: report }, '*')
      return
    }
    const candidateUrl = report.pageCandidate ? location.href : report.url
    reportQueue.push({
      ...report,
      url: candidateUrl,
      pageUrl: location.href,
      title: document.title || ''
    })
    if (reportQueue.length > 200) {
      reportQueue.splice(0, reportQueue.length - 200)
    }
  }

  const normalizeContentLength = (value) => {
    const size = Number(value)
    return Number.isFinite(size) && size > 0 ? Math.round(size) : undefined
  }

  const reportCandidate = ({ url, mimeType, hint, source, duration, contentLength, isPlaying }) => {
    let absoluteUrl
    try {
      absoluteUrl = new URL(String(url || ''), location.href).toString()
    } catch {
      return
    }
    const kind = classify(absoluteUrl, mimeType, hint)
    if (!kind) {
      return
    }
    const mime = cleanMime(mimeType)
    const normalizedDuration = Number.isFinite(duration) && duration > 0 ? duration : undefined
    const normalizedContentLength = normalizeContentLength(contentLength)
    // Include duration/size so later metadata upgrades re-report the candidate.
    const signal = `${kind}|${mime}|${isPlaying ? 'playing' : 'idle'}|${normalizedDuration || 0}|${normalizedContentLength || 0}`
    if (reported.get(absoluteUrl) === signal) {
      return
    }
    reported.set(absoluteUrl, signal)
    if (reported.size > 200) {
      reported.delete(reported.keys().next().value)
    }
    queueReport({
      url: absoluteUrl,
      mimeType: mime || undefined,
      kind,
      source,
      duration: normalizedDuration,
      contentLength: normalizedContentLength,
      isPlaying: Boolean(isPlaying)
    })
  }

  const inspectMediaElement = (element, source) => {
    const tagName = element.tagName?.toLowerCase()
    const hint = tagName === 'audio' ? 'audio' : 'video'
    const isPlaying = 'paused' in element ? !element.paused : false
    const duration = 'duration' in element ? element.duration : undefined
    const urls = [element.currentSrc, element.src, element.getAttribute?.('src')]
    for (const url of urls) {
      if (url && !String(url).startsWith('blob:')) {
        reportCandidate({
          url,
          mimeType: element.type,
          hint,
          source: `dom:${source}`,
          duration,
          isPlaying
        })
      }
    }
    if (tagName === 'video' || tagName === 'audio') {
      for (const child of element.querySelectorAll('source')) {
        reportCandidate({
          url: child.src || child.getAttribute('src'),
          mimeType: child.type,
          hint,
          source: `dom:${source}:source`,
          duration,
          isPlaying
        })
      }
      if (isPlaying) {
        const pageKey = `page:${hint}:${location.href}`
        if (!reported.has(pageKey)) {
          reported.set(pageKey, 'playing')
          queueReport({
            url: location.href,
            kind: hint,
            source: `page:${source}`,
            duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
            isPlaying: true,
            pageCandidate: true
          })
        }
      }
    }
  }

  const scanMediaElements = (source = 'scan') => {
    for (const element of document.querySelectorAll('video, audio, source')) {
      inspectMediaElement(element, source)
    }
  }

  const inspectPerformanceEntry = (entry) => {
    const initiator = String(entry.initiatorType || '').toLowerCase()
    const path = (() => {
      try {
        return new URL(entry.name).pathname
      } catch {
        return ''
      }
    })()
    if (!(mediaExtensions.test(path) || ['video', 'audio'].includes(initiator))) {
      return
    }
    // transferSize/encodedBodySize are often 0 for opaque cross-origin resources.
    const contentLength =
      normalizeContentLength(entry.transferSize) ||
      normalizeContentLength(entry.encodedBodySize) ||
      normalizeContentLength(entry.decodedBodySize)
    reportCandidate({
      url: entry.name,
      hint: initiator === 'audio' ? 'audio' : 'video',
      source: `performance:${initiator || 'resource'}`,
      contentLength,
      isPlaying: document.querySelector('video:not([paused]), audio:not([paused])') !== null
    })
  }

  const scanPerformanceEntries = () => {
    for (const entry of performance.getEntriesByType('resource')) {
      inspectPerformanceEntry(entry)
    }
  }

  const reportLocation = () => {
    if (window.top !== window || location.href === lastLocation) {
      return
    }
    lastLocation = location.href
    reported.clear()
    reportQueue.splice(0)
  }

  const installLocationDetection = () => {
    window.addEventListener('popstate', reportLocation)
    window.addEventListener('hashchange', reportLocation)
  }

  if (window.top === window) {
    window.addEventListener('message', (event) => {
      const report = event.data?.__vetchMediaCandidate
      if (!report || typeof report !== 'object') {
        return
      }
      queueReport(report)
    })
    Object.defineProperty(window, '__VETCH_DRAIN_MEDIA__', {
      value: () => reportQueue.splice(0),
      writable: false,
      configurable: false
    })
  }

  // Keep the page's native APIs untouched. Challenge providers inspect these APIs
  // and can reject a document-start script that wraps fetch, XHR, History, or URL methods.
  installLocationDetection()

  const startDomDetection = () => {
    reportLocation()
    scanMediaElements('ready')
    document.addEventListener(
      'play',
      (event) => {
        inspectMediaElement(event.target, 'play')
        scanPerformanceEntries()
      },
      true
    )
    document.addEventListener(
      'loadedmetadata',
      (event) => inspectMediaElement(event.target, 'metadata'),
      true
    )
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          inspectMediaElement(mutation.target, 'attribute')
          continue
        }
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) {
            if (node.matches('video, audio, source')) {
              inspectMediaElement(node, 'mutation')
            }
            for (const media of node.querySelectorAll('video, audio, source')) {
              inspectMediaElement(media, 'mutation')
            }
          }
        }
      }
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['src', 'type'],
      childList: true,
      subtree: true
    })
  }

  if (document.documentElement) {
    startDomDetection()
  } else {
    document.addEventListener('DOMContentLoaded', startDomDetection, { once: true })
  }

  if (typeof PerformanceObserver === 'function') {
    const performanceObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        inspectPerformanceEntry(entry)
      }
    })
    performanceObserver.observe({ entryTypes: ['resource'] })
  }
  window.setInterval(() => {
    scanMediaElements('interval')
    scanPerformanceEntries()
    reportLocation()
  }, 2000)
})()

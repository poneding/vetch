export type BrowserShortcutAction = 'back' | 'focusAddress' | 'forward' | 'reload' | 'toggleMedia'

/** Dispatched into the toolbar webview when another browser surface requests address focus. */
export const FOCUS_ADDRESS_EVENT = 'vetch-focus-address'

const isMacPlatform = (): boolean => {
  if (typeof navigator === 'undefined') {
    return false
  }
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
}

export const isEditableKeyboardTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (
    target.isContentEditable ||
    target.closest('[contenteditable]:not([contenteditable="false"])')
  ) {
    return true
  }
  const tagName = target.tagName
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
}

/** Match browser chrome shortcuts. Returns null when the event is not a known shortcut. */
export const matchBrowserShortcut = (event: KeyboardEvent): BrowserShortcutAction | null => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  const mod = event.metaKey || event.ctrlKey

  if (mod && !event.altKey && !event.shiftKey && key === 'r') {
    return 'reload'
  }
  if (mod && !event.altKey && !event.shiftKey && key === 'l') {
    return 'focusAddress'
  }
  if (
    mod &&
    !event.altKey &&
    !event.shiftKey &&
    key === 'b' &&
    !isEditableKeyboardTarget(event.target)
  ) {
    return 'toggleMedia'
  }
  if (mod && !event.altKey && !event.shiftKey && key === '[') {
    return 'back'
  }
  if (mod && !event.altKey && !event.shiftKey && key === ']') {
    return 'forward'
  }
  if (!(mod || event.shiftKey) && event.altKey && event.key === 'ArrowLeft') {
    if (isEditableKeyboardTarget(event.target)) {
      return null
    }
    return 'back'
  }
  if (!(mod || event.shiftKey) && event.altKey && event.key === 'ArrowRight') {
    if (isEditableKeyboardTarget(event.target)) {
      return null
    }
    return 'forward'
  }
  if (!(mod || event.altKey || event.shiftKey) && event.key === 'F5') {
    return 'reload'
  }
  return null
}

export const browserShortcutLabels = (): Record<BrowserShortcutAction, string> => {
  if (isMacPlatform()) {
    return {
      back: '⌘[',
      focusAddress: '⌘L',
      forward: '⌘]',
      reload: '⌘R',
      toggleMedia: '⌘B'
    }
  }
  return {
    back: 'Alt+Left',
    focusAddress: 'Ctrl+L',
    forward: 'Alt+Right',
    reload: 'Ctrl+R',
    toggleMedia: 'Ctrl+B'
  }
}

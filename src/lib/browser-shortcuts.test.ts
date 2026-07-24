import { describe, expect, it } from 'vitest'
import { isEditableKeyboardTarget, matchBrowserShortcut } from './browser-shortcuts'

const createKeyboardEvent = ({
  key,
  metaKey = false,
  ctrlKey = false,
  altKey = false,
  shiftKey = false,
  target
}: {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  target?: EventTarget
}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey,
    ctrlKey,
    altKey,
    shiftKey,
    bubbles: true
  })
  if (target) {
    Object.defineProperty(event, 'target', { value: target })
  }
  return event
}

describe('browser shortcuts', () => {
  it('matches reload with cmd/ctrl+r and F5', () => {
    expect(matchBrowserShortcut(createKeyboardEvent({ key: 'r', metaKey: true }))).toBe('reload')
    expect(matchBrowserShortcut(createKeyboardEvent({ key: 'R', ctrlKey: true }))).toBe('reload')
    expect(matchBrowserShortcut(createKeyboardEvent({ key: 'F5' }))).toBe('reload')
  })

  it('matches history navigation and media panel toggle', () => {
    expect(matchBrowserShortcut(createKeyboardEvent({ key: '[', metaKey: true }))).toBe('back')
    expect(matchBrowserShortcut(createKeyboardEvent({ key: ']', ctrlKey: true }))).toBe('forward')
    expect(matchBrowserShortcut(createKeyboardEvent({ key: 'ArrowLeft', altKey: true }))).toBe(
      'back'
    )
    expect(matchBrowserShortcut(createKeyboardEvent({ key: 'ArrowRight', altKey: true }))).toBe(
      'forward'
    )
    expect(matchBrowserShortcut(createKeyboardEvent({ key: 'b', metaKey: true }))).toBe(
      'toggleMedia'
    )
    expect(matchBrowserShortcut(createKeyboardEvent({ key: 'b', ctrlKey: true }))).toBe(
      'toggleMedia'
    )
    expect(matchBrowserShortcut(createKeyboardEvent({ key: 'l', metaKey: true }))).toBe(
      'focusAddress'
    )
    expect(matchBrowserShortcut(createKeyboardEvent({ key: 'L', ctrlKey: true }))).toBe(
      'focusAddress'
    )
  })

  it('ignores alt-arrow shortcuts while typing in editable fields', () => {
    const input = document.createElement('input')
    expect(
      matchBrowserShortcut(createKeyboardEvent({ key: 'ArrowLeft', altKey: true, target: input }))
    ).toBeNull()
    expect(isEditableKeyboardTarget(input)).toBe(true)
  })

  it('does not toggle media from editable controls or contenteditable descendants', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const select = document.createElement('select')
    const editor = document.createElement('div')
    const editorChild = document.createElement('span')
    editor.setAttribute('contenteditable', 'true')
    editor.append(editorChild)

    for (const target of [input, textarea, select, editor, editorChild]) {
      expect(isEditableKeyboardTarget(target)).toBe(true)
      expect(
        matchBrowserShortcut(createKeyboardEvent({ key: 'b', ctrlKey: true, target }))
      ).toBeNull()
    }
  })

  it('still reloads and focuses the address bar while typing', () => {
    const input = document.createElement('input')
    expect(
      matchBrowserShortcut(createKeyboardEvent({ key: 'r', metaKey: true, target: input }))
    ).toBe('reload')
    expect(
      matchBrowserShortcut(createKeyboardEvent({ key: 'l', ctrlKey: true, target: input }))
    ).toBe('focusAddress')
  })
})

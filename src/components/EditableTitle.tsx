import { Check, Pen } from 'lucide-react'
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface EditableTitleProps {
  as?: 'h3' | 'strong' | 'span'
  className?: string
  disabled?: boolean
  title: string
  onSave: (title: string) => void | Promise<void>
}

export function EditableTitle({
  as: Tag = 'h3',
  className,
  disabled = false,
  title,
  onSave
}: EditableTitleProps) {
  const { t } = useTranslation()
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editing) {
      setDraft(title)
    }
  }, [editing, title])

  useEffect(() => {
    if (!disabled) {
      return
    }
    setDraft(title)
    setEditing(false)
  }, [disabled, title])

  useEffect(() => {
    if (!editing) {
      return
    }
    const input = inputRef.current
    if (!input) {
      return
    }
    input.focus()
    input.select()
  }, [editing])

  const beginEdit = () => {
    if (disabled || saving) {
      return
    }
    setDraft(title)
    setEditing(true)
  }

  const cancelEdit = () => {
    if (saving) {
      return
    }
    setDraft(title)
    setEditing(false)
  }

  const commitEdit = async () => {
    if (disabled || saving) {
      return
    }
    const nextTitle = draft.trim()
    if (!nextTitle) {
      setDraft(title)
      setEditing(false)
      return
    }
    if (nextTitle === title.trim()) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await onSave(nextTitle)
      setEditing(false)
    } catch {
      setDraft(title)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void commitEdit()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelEdit()
    }
  }

  if (editing) {
    return (
      <div
        className={
          className ? `editable-title is-editing ${className}` : 'editable-title is-editing'
        }
      >
        <input
          aria-label={t('download.renameTitle')}
          className="editable-title-input"
          disabled={disabled || saving}
          id={inputId}
          onBlur={() => void commitEdit()}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          ref={inputRef}
          spellCheck={false}
          value={draft}
        />
        <button
          aria-label={t('download.confirmRename')}
          className="icon-button editable-title-action"
          disabled={disabled || saving || !draft.trim()}
          onClick={() => void commitEdit()}
          onMouseDown={(event) => event.preventDefault()}
          title={t('download.confirmRename')}
          type="button"
        >
          <Check size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className={className ? `editable-title ${className}` : 'editable-title'}>
      <button
        aria-label={t('download.edit')}
        className="editable-title-trigger"
        disabled={disabled}
        onClick={beginEdit}
        title={t('download.edit')}
        type="button"
      >
        <Tag className="editable-title-text" title={title}>
          {title}
        </Tag>
        <span aria-hidden="true" className="editable-title-pen">
          <Pen size={12} />
        </span>
      </button>
    </div>
  )
}

import { Check, ChevronDown } from 'lucide-react'
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'

type ComboboxValue = number | string

export interface ComboboxOption<Value extends ComboboxValue> {
  label: string
  value: Value
}

interface ComboboxProps<Value extends ComboboxValue> {
  ariaLabel: string
  disabled?: boolean
  onChange: (value: Value) => void
  options: ComboboxOption<Value>[]
  value: Value
}

export function Combobox<Value extends ComboboxValue>({
  ariaLabel,
  disabled = false,
  onChange,
  options,
  value
}: ComboboxProps<Value>) {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [opensUpward, setOpensUpward] = useState(false)
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  )
  const selectedOption = options[selectedIndex]

  useEffect(() => {
    if (!open) {
      return
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const openOptions = () => {
    if (disabled || options.length === 0) {
      return
    }
    const bounds = rootRef.current?.getBoundingClientRect()
    const optionsHeight = 248
    setOpensUpward(Boolean(bounds && window.innerHeight - bounds.bottom < optionsHeight))
    setHighlightedIndex(selectedIndex)
    setOpen(true)
  }

  const selectOption = (index: number) => {
    const option = options[index]
    if (!option) {
      return
    }
    onChange(option.value)
    setOpen(false)
  }

  const moveHighlight = (offset: number) => {
    if (options.length === 0) {
      return
    }
    setHighlightedIndex((current) => (current + offset + options.length) % options.length)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        openOptions()
        return
      }
      moveHighlight(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault()
      selectOption(highlightedIndex)
      return
    }
    if (event.key === 'Home' && open) {
      event.preventDefault()
      setHighlightedIndex(0)
      return
    }
    if (event.key === 'End' && open) {
      event.preventDefault()
      setHighlightedIndex(Math.max(0, options.length - 1))
    }
  }

  return (
    <div className="combobox" ref={rootRef}>
      <button
        aria-activedescendant={open ? `${listboxId}-option-${highlightedIndex}` : undefined}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="combobox-trigger"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openOptions())}
        onKeyDown={handleKeyDown}
        role="combobox"
        type="button"
      >
        <span>{selectedOption?.label ?? String(value)}</span>
        <ChevronDown className={open ? 'combobox-chevron is-open' : 'combobox-chevron'} size={15} />
      </button>
      {open ? (
        <div
          aria-label={ariaLabel}
          className={opensUpward ? 'combobox-options opens-upward' : 'combobox-options'}
          id={listboxId}
          role="listbox"
        >
          {options.map((option, index) => (
            <button
              aria-selected={option.value === value}
              className={
                index === highlightedIndex ? 'combobox-option is-highlighted' : 'combobox-option'
              }
              id={`${listboxId}-option-${index}`}
              key={String(option.value)}
              onClick={() => selectOption(index)}
              onPointerEnter={() => setHighlightedIndex(index)}
              role="option"
              tabIndex={-1}
              type="button"
            >
              <span>{option.label}</span>
              {option.value === value ? <Check aria-hidden="true" size={15} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

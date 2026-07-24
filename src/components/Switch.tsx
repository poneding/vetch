interface SwitchProps {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}

export function Switch({ checked, label, onChange }: SwitchProps) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span className="switch-thumb" />
    </button>
  )
}

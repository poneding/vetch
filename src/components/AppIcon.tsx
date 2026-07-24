import vetchIcon from '../../src-tauri/icons/vetch.svg?url'

interface AppIconProps {
  size?: number
}

export function AppIcon({ size = 24 }: AppIconProps) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className="app-icon"
      height={size}
      src={vetchIcon}
      width={size}
    />
  )
}

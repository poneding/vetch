import type { ReactNode } from 'react'
import { useState } from 'react'
import { normalizeThumbnailUrl } from '../lib/format'

interface MediaThumbnailProps {
  children: ReactNode
  height: number
  src?: string
  width: number
}

export function MediaThumbnail({ children, height, src, width }: MediaThumbnailProps) {
  const imageUrl = normalizeThumbnailUrl(src)
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)

  if (!imageUrl || failedImageUrl === imageUrl) {
    return children
  }

  return (
    <img
      alt=""
      height={height}
      loading="lazy"
      onError={() => setFailedImageUrl(imageUrl)}
      referrerPolicy="no-referrer"
      src={imageUrl}
      width={width}
    />
  )
}

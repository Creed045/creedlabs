import { useState } from 'react'
import { PlateIcon } from './Icons'

/** Image with a graceful placeholder when the URL is missing or broken. */
export function FoodImage({ src, alt, className = '' }: { src: string | null; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)

  if (!src || failed) {
    return (
      <div className={`food-img food-img--placeholder ${className}`} role="img" aria-label={alt}>
        <PlateIcon size={36} />
      </div>
    )
  }

  const resolvedSrc = src.startsWith('/images/')
    ? `${import.meta.env.BASE_URL}${src.slice(1)}`
    : src

  return (
    <img
      className={`food-img ${loaded ? 'is-loaded' : ''} ${className}`}
      src={resolvedSrc}
      alt={alt}
      loading="lazy"
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />
  )
}
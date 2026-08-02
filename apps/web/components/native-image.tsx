import type { ImgHTMLAttributes } from 'react'

type NativeImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'height' | 'width'> & Readonly<{
  fill?: boolean
  height?: number
  priority?: boolean
  unoptimized?: boolean
  width?: number
}>

/**
 * Public product captures are already reviewed, compressed, and served from bounded URLs. This
 * native server image keeps responsive semantics without adding Next Image's client runtime.
 */
export function NativeImage({
  className = '',
  fill = false,
  loading,
  priority = false,
  unoptimized: _unoptimized,
  ...props
}: NativeImageProps) {
  void _unoptimized
  const resolvedClassName = fill ? `absolute inset-0 h-full w-full ${className}` : className

  return <img
    {...props}
    className={resolvedClassName}
    decoding="async"
    fetchPriority={priority ? 'high' : props.fetchPriority}
    loading={priority ? 'eager' : (loading ?? 'lazy')}
  />
}

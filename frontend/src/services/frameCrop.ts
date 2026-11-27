export interface CenterCropRect {
  sx: number
  sy: number
  width: number
  height: number
}

export function getCenterCropRect(width: number, height: number): CenterCropRect {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError('Frame dimensions must be positive finite numbers.')
  }

  const size = Math.min(width, height)
  return {
    sx: (width - size) / 2,
    sy: (height - size) / 2,
    width: size,
    height: size,
  }
}

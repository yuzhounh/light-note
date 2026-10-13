const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(value, maximum))

export function contextMenuPosition(anchor, point, size, bounds) {
  const left = clamp(point.x - size.width / 2, bounds.left, bounds.right - size.width)
  const below = anchor.bottom + 8
  const above = anchor.top - size.height - 8
  const top = below + size.height <= bounds.bottom ? below
    : above >= bounds.top ? above : clamp(point.y + 8, bounds.top, bounds.bottom - size.height)
  return { left, top }
}

// Measure in the preview's own font context, including Android WebView text zoom.
// The hidden block uses the browser's normal word wrapping, not character counts.
export function measurePreviewLines(measure, text, width, tagWidth = 0, gap = 0) {
  if (!text || width <= 0) return { first: text, second: '', single: true }
  if (measure.textContent !== text) measure.textContent = text
  const node = measure.firstChild
  const range = measure.ownerDocument.createRange()
  const segments = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(s => s.index + s.segment.length)
    : Array.from(text).map((_, i, chars) => chars.slice(0, i + 1).join('').length)
  range.setStart(node, 0)
  const firstBottom = () => {
    range.setEnd(node, segments[0])
    return range.getBoundingClientRect().bottom
  }
  const fits = (end, bottom) => {
    range.setEnd(node, end)
    return range.getBoundingClientRect().bottom <= bottom + 0.5
  }
  measure.style.width = `${Math.max(0, width - tagWidth - (tagWidth ? gap : 0))}px`
  if (fits(text.length, firstBottom())) return { first: text, second: '', single: true }
  measure.style.width = `${width}px`
  const bottom = firstBottom()
  if (fits(text.length, bottom)) return { first: text, second: '', single: false }
  let low = 0, high = segments.length
  while (low + 1 < high) {
    const mid = (low + high) >> 1
    if (fits(segments[mid - 1], bottom)) low = mid
    else high = mid
  }
  const end = segments[Math.max(0, low - 1)]
  return { first: text.slice(0, end).trimEnd(), second: text.slice(end).trimStart(), single: false }
}

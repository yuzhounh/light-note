import React, { useLayoutEffect, useRef, useState } from 'react'
import { measurePreviewLines } from '../../core/previewLayout'

export function PhoneNotePreview({ text, tag, renderText }) {
  const rootRef = useRef(null)
  const measureRef = useRef(null)
  const tagRef = useRef(null)
  const [lines, setLines] = useState({ first: text, second: '', single: true })

  useLayoutEffect(() => {
    const root = rootRef.current
    let frame = 0, active = true
    const update = () => {
      if (!active || !root.getBoundingClientRect().width) return
      const next = measurePreviewLines(measureRef.current, text, root.getBoundingClientRect().width,
        tagRef.current?.getBoundingClientRect().width || 0, 8)
      setLines(previous => previous.first === next.first && previous.second === next.second && previous.single === next.single ? previous : next)
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update) }
    const observer = new ResizeObserver(schedule)
    observer.observe(root)
    // A font probe also detects text zoom changes when container width is unchanged.
    observer.observe(root.querySelector('[data-preview-font]'))
    if (tagRef.current) observer.observe(tagRef.current)
    document.fonts?.ready.then(schedule)
    document.fonts?.addEventListener('loadingdone', schedule)
    window.addEventListener('resize', schedule)
    update()
    return () => {
      active = false
      observer.disconnect()
      cancelAnimationFrame(frame)
      document.fonts?.removeEventListener('loadingdone', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [text, tag])

  return (
    <div ref={rootRef} className={`phone-note-preview mt-1 text-[14px] text-muted leading-[1.4] ${tag ? 'has-tag' : ''} ${lines.single ? 'is-single' : ''}`}>
      <span className="phone-preview-first">{renderText(lines.first || '\u00a0')}</span>
      {!lines.single && <span className="phone-preview-last">{renderText(lines.second || '\u00a0')}</span>}
      {tag && <span ref={tagRef} className="phone-preview-tag text-[11px] px-1.5 py-0.5 rounded-md bg-tint text-brand" title={tag}>{tag}</span>}
      <span ref={measureRef} className="phone-preview-measure" aria-hidden="true" />
      <span data-preview-font className="phone-preview-font" aria-hidden="true">M国</span>
    </div>
  )
}

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { History, Trash2 } from 'lucide-react'
import { countWords, formatInfoTime } from '../../core/noteInfo'
import { contextMenuPosition } from './contextMenuPosition'
import { useBackDismiss } from '../../hooks/useBackDismiss'

export function NoteContextMenu({ note, anchor, scrollElement, onClose, onOpenHistory, onSoftDelete }) {
  const menuRef = useRef(null)
  const nextPressRef = useRef(false)
  const [position, setPosition] = useState(null)
  useBackDismiss(true, onClose, 50)

  useLayoutEffect(() => {
    const viewport = window.visualViewport
    const style = getComputedStyle(document.documentElement)
    const safe = name => parseFloat(style.getPropertyValue(`--safe-${name}`)) || 0
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0
    const bounds = { left: left + safe('left') + 12, top: top + safe('top') + 12,
      right: left + (viewport?.width || window.innerWidth) - safe('right') - 12,
      bottom: top + (viewport?.height || window.innerHeight) - safe('bottom') - 12 }
    const width = Math.min(280, bounds.right - bounds.left)
    const maxHeight = bounds.bottom - bounds.top
    const menu = menuRef.current
    menu.style.width = `${width}px`
    menu.style.maxHeight = `${maxHeight}px`
    const size = menu.getBoundingClientRect()
    setPosition({ ...contextMenuPosition(anchor.rect, anchor.point, size, bounds), width, maxHeight })
    menu.querySelector('button')?.focus({ preventScroll: true })
  }, [anchor])

  useEffect(() => {
    const previousOverflow = scrollElement?.style.overflow
    if (scrollElement) scrollElement.style.overflow = 'hidden'
    const dismissOnEscape = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', dismissOnEscape)
    window.addEventListener('resize', onClose)
    return () => {
      if (scrollElement) scrollElement.style.overflow = previousOverflow
      window.removeEventListener('keydown', dismissOnEscape)
      window.removeEventListener('resize', onClose)
    }
  }, [scrollElement, onClose])

  return (
    <div className="note-context-mask fixed inset-0 z-50 bg-black/10 dark:bg-black/25"
      onPointerDownCapture={() => { nextPressRef.current = true }}
      onClickCapture={event => {
        // The release ending the original long press must not activate an action.
        if (!nextPressRef.current && event.detail > 0) { event.preventDefault(); event.stopPropagation() }
      }}
      onClick={event => { event.stopPropagation(); onClose() }}
      onContextMenu={event => event.preventDefault()}>
      <div ref={menuRef} role="dialog" aria-modal="true" aria-label={`笔记“${note.title || '无标题笔记'}”的操作`}
        className="note-context-menu fixed rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2 shadow-xl overflow-y-auto"
        style={{ ...position, width: position?.width || 280, visibility: position ? 'visible' : 'hidden' }}
        onClick={event => event.stopPropagation()}>
        <div className="space-y-2">
          {onOpenHistory && <button type="button"
            onClick={() => { onClose(); onOpenHistory(note) }}
            className="w-full h-14 min-h-14 flex items-center gap-3 px-3 rounded-lg text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer">
            <History size={18} /><span>历史版本</span>
          </button>}
          {onSoftDelete && <button type="button"
            onClick={() => { onClose(); if (confirm('确定将该笔记移入回收站？')) onSoftDelete(note.id) }}
            className="w-full h-14 min-h-14 flex items-center gap-3 px-3 rounded-lg text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer">
            <Trash2 size={18} /><span>移入回收站</span>
          </button>}
        </div>
        <div className="mt-2 border-t border-zinc-200 dark:border-zinc-700 pt-2 px-3 pb-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          <div>字数统计：{countWords(note.body_text)}</div>
          <div>创建于 {formatInfoTime(note.created_at || note.updated_at)}</div>
          <div>编辑于 {formatInfoTime(note.updated_at)}</div>
        </div>
      </div>
    </div>
  )
}

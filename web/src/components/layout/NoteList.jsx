import React, { useState, useEffect } from 'react'
import { Menu, Trash2, Pin, FileText } from 'lucide-react'
import { syncService } from '../../core/sync/syncService'

function extractFirstImage(bodyHtml) {
  if (!bodyHtml) return null
  const match = bodyHtml.match(/<img[^>]+src=["']([^"']+)["']/i)
  return match ? match[1] : null
}

function NoteCardThumbnail({ src }) {
  const [realSrc, setRealSrc] = useState(src)
  useEffect(() => {
    let active = true
    if (src && src.startsWith('https://lightnote.attachments/')) {
      syncService.resolveImageUrl(src).then(resolved => {
        if (active && resolved) setRealSrc(resolved)
      })
    } else {
      setRealSrc(src)
    }
    return () => { active = false }
  }, [src])

  if (!realSrc) return null
  return (
    <div className="w-14 h-14 shrink-0 rounded-md overflow-hidden bg-zinc-100 dark:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-700/80 flex items-center justify-center">
      <img src={realSrc} alt="" className="w-full h-full object-cover" />
    </div>
  )
}

export function NoteList({
  notes,
  activeNoteId,
  onSelectNote,
  searchQuery,
  onSearchChange,
  currentNotebookName,
  onOpenSidebar,
  onTogglePin,
  onSoftDelete,
  isMobile
}) {
  const [visibleCount, setVisibleCount] = useState(25)

  // Reset pagination when filter or notes change
  useEffect(() => {
    setVisibleCount(25)
  }, [notes.length, searchQuery, currentNotebookName])

  function handleScroll(e) {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    if (scrollTop + clientHeight >= scrollHeight - 120) {
      if (visibleCount < notes.length) {
        setVisibleCount(prev => Math.min(prev + 20, notes.length))
      }
    }
  }

  function formatFullDate(isoString) {
    if (!isoString) return ''
    const d = new Date(isoString)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const mins = String(d.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day} ${hours}:${mins}`
  }

  function highlightMatch(text, query) {
    if (!query || !query.trim() || !text) return text
    const q = query.trim()
    const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    const parts = text.split(regex)
    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="bg-amber-200 dark:bg-amber-900/70 text-zinc-900 dark:text-zinc-100 rounded px-0.5">
          {part}
        </mark>
      ) : (
        part
      )
    )
  }

  const visibleNotes = notes.slice(0, visibleCount)

  return (
    <div className="flex flex-col h-full w-full bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 select-none">
      {/* Top Search Input */}
      <div className="p-3 pb-1.5 space-y-2 shrink-0">
        <div className="flex items-center gap-2">
          {isMobile && (
            <button
              onClick={onOpenSidebar}
              className="p-1.5 -ml-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 cursor-pointer"
            >
              <Menu size={18} />
            </button>
          )}
          <input
            type="text"
            placeholder="搜索标题和正文"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            className="w-full px-3 py-1.5 rounded-md bg-zinc-100 dark:bg-zinc-900 border border-transparent focus:border-zinc-300 dark:focus:border-zinc-700 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 outline-none transition"
          />
        </div>

        {/* Category & Total Count Header */}
        <div className="px-1 text-sm text-zinc-800 dark:text-zinc-200 font-medium flex items-center justify-between">
          <div>
            <span>{currentNotebookName || '全部笔记'}</span>
            <span className="ml-1 text-xs text-zinc-500 font-normal">({notes.length}条)</span>
          </div>
          {notes.length > visibleNotes.length && (
            <span className="text-[11px] text-zinc-400 font-normal">
              已载入 {visibleNotes.length} 条
            </span>
          )}
        </div>
      </div>

      {/* Note Cards List (Progressive Loading on Scroll) */}
      <div 
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-2 py-1 space-y-1"
      >
        {notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-zinc-400 text-sm text-center p-6 space-y-2 select-none">
            <FileText size={32} className="opacity-30 mb-1" />
            <p className="font-medium text-zinc-600 dark:text-zinc-300">暂无相关笔记</p>
            <p className="text-xs text-zinc-400">点击左上角“新建笔记”或登录账号同步云端笔记</p>
          </div>
        ) : (
          <>
            {visibleNotes.map(note => {
              const isSelected = note.id === activeNoteId
              const thumbnailSrc = extractFirstImage(note.body_html)

              return (
                <div
                  key={note.id}
                  onClick={() => onSelectNote(note.id)}
                  className={`group relative p-3 rounded-md cursor-pointer transition ${
                    isSelected
                      ? 'bg-[#e8f0fe] dark:bg-sky-950/40 text-zinc-900 dark:text-zinc-100'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/60 text-zinc-800 dark:text-zinc-200'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="mb-1 flex items-center gap-1.5">
                        {note.is_pinned === 1 && (
                          <Pin size={12} className="text-amber-500 shrink-0 fill-amber-500" />
                        )}
                        <h4 className="text-[14.5px] font-semibold truncate text-zinc-900 dark:text-zinc-100">
                          {highlightMatch(note.title || '无标题', searchQuery)}
                        </h4>
                      </div>

                      <p className="text-[13px] text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-relaxed mb-2">
                        {highlightMatch(note.body_text || '无附加正文...', searchQuery)}
                      </p>

                      <div className="flex items-center justify-between text-xs text-zinc-400 font-sans">
                        <span>{formatFullDate(note.updated_at)}</span>

                        {/* Quick action on hover */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                          {onTogglePin && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                onTogglePin(note.id)
                              }}
                              className={`p-0.5 rounded transition ${note.is_pinned === 1 ? 'text-amber-500' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200'}`}
                              title={note.is_pinned === 1 ? '取消置顶' : '置顶笔记'}
                            >
                              <Pin size={13} />
                            </button>
                          )}
                          {onSoftDelete && (
                            <button
                              onClick={(e) => { 
                                e.stopPropagation()
                                if (confirm('确定移入回收站？')) onSoftDelete(note.id)
                              }}
                              className="p-0.5 hover:text-rose-500 rounded transition text-zinc-400"
                              title="移入回收站"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Card Thumbnail if note contains image */}
                    {thumbnailSrc && (
                      <NoteCardThumbnail src={thumbnailSrc} />
                    )}
                  </div>
                </div>
              )
            })}

            {visibleCount < notes.length && (
              <div className="py-2 text-center text-xs text-zinc-400">
                向下滚动加载更多...
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

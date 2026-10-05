import React, { useState, useEffect } from 'react'
import { Menu, Trash2, Pin, FileText } from 'lucide-react'

function getNotePreviewText(bodyText) {
  if (!bodyText) return '无附加正文...'
  const match = /^\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s*/.exec(bodyText)
  if (match) {
    const after = bodyText.slice(match[0].length).trim()
    if (after) {
      return after
    }
  }
  return bodyText.trim() || '无附加正文...'
}

export function NoteList({
  notes,
  activeNoteId,
  onSelectNote,
  searchQuery,
  onSearchChange,
  currentNotebookName,
  notebooks = [],
  currentNotebookId = null,
  onOpenSidebar,
  onTogglePin,
  onSoftDelete,
  isMobile
}) {
  const [visibleCount, setVisibleCount] = useState(25)

  // Check if all displayed notes belong to the same notebook
  const isSingleNotebook = Boolean(currentNotebookId) || (
    notes.length > 0 && notes.every(n => (n.notebook_id || null) === (notes[0].notebook_id || null))
  )

  function getNotebookName(notebookId) {
    if (!notebookId) return '未归类'
    const found = notebooks.find(nb => nb.id === notebookId)
    return found ? found.name : '未归类'
  }

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
    <div className="note-list flex flex-col h-full w-full bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 select-none">
      {/* Top Search Input */}
      <div className="p-3 pb-1.5 space-y-2 shrink-0">
        <div className="flex items-center gap-2">
          {isMobile && (
            <button
              onClick={onOpenSidebar}
              aria-label="打开导航与设置"
              title="打开导航与设置"
              className="w-10 h-10 min-w-10 min-h-10 rounded-full border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 flex items-center justify-center text-zinc-700 dark:text-zinc-200 hover:border-emerald-500 hover:text-emerald-500 transition cursor-pointer shadow-xs shrink-0"
            >
              <Menu size={20} />
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
        className="note-list-scroll flex-1 min-h-0 overflow-y-auto px-2 py-1 space-y-1"
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
                  <div className="flex flex-col">
                    {/* Top part: Lines 1-3 (Title + Preview) */}
                    <div className="min-w-0">
                      <div className="mb-1 flex items-center gap-1.5">
                        {note.is_pinned === 1 && (
                          <Pin size={12} className="text-amber-500 shrink-0 fill-amber-500" />
                        )}
                        <h4 className="text-[14.5px] font-semibold truncate text-zinc-900 dark:text-zinc-100">
                          {highlightMatch(note.title || '无标题', searchQuery)}
                        </h4>
                      </div>

                      <p className="text-[13px] text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                        {highlightMatch(getNotePreviewText(note.body_text), searchQuery)}
                      </p>
                    </div>

                    {/* Bottom part: Line 4 (Date on left, Notebook immediately behind, Actions on far right) */}
                    <div className="note-card-footer flex items-center justify-between text-xs text-zinc-400 font-sans mt-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                        <span className="shrink-0">{formatFullDate(note.updated_at)}</span>

                        {!isSingleNotebook && (
                          <span
                            className={`truncate text-[11px] px-1.5 py-0.5 rounded max-w-[140px] transition ${
                              isSelected
                                ? 'bg-blue-100/80 dark:bg-sky-900/60 text-blue-700 dark:text-sky-300'
                                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                            }`}
                            title={getNotebookName(note.notebook_id)}
                          >
                            {getNotebookName(note.notebook_id)}
                          </span>
                        )}
                      </div>

                      {/* Quick action on hover */}
                      <div className="note-actions flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
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

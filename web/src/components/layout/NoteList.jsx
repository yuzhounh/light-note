import React from 'react'
import { Menu, Trash2 } from 'lucide-react'

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

  return (
    <div className="flex flex-col h-full w-full bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 select-none">
      {/* Top Search Input */}
      <div className="p-3 pb-1.5 space-y-2">
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
            className="w-full px-3 py-1.5 rounded-md bg-zinc-100 dark:bg-zinc-900 border border-transparent focus:border-zinc-300 dark:focus:border-zinc-700 text-xs text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 outline-none transition"
          />
        </div>

        {/* Category & Count Header */}
        <div className="px-1 text-xs text-zinc-700 dark:text-zinc-300 font-normal">
          <span>{currentNotebookName || '全部笔记'}</span>
          <span className="ml-1 text-zinc-500">({notes.length}条)</span>
        </div>
      </div>

      {/* Note Cards List */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
        {notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-zinc-400 text-xs text-center p-4">
            <p>暂无相关笔记</p>
          </div>
        ) : (
          notes.map(note => {
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
                <div className="mb-1">
                  <h4 className="text-xs font-bold truncate">
                    {highlightMatch(note.title || '无标题', searchQuery)}
                  </h4>
                </div>

                <p className="text-[11px] text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-relaxed mb-2">
                  {highlightMatch(note.body_text || '无附加正文...', searchQuery)}
                </p>

                <div className="flex items-center justify-between text-[11px] text-zinc-400 font-sans">
                  <span>{formatFullDate(note.updated_at)}</span>

                  {/* Context quick action on hover: only delete icon */}
                  {onSoftDelete && (
                    <button
                      onClick={(e) => { 
                        e.stopPropagation()
                        if (confirm('确定移入回收站？')) onSoftDelete(note.id)
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-rose-500 rounded transition text-zinc-400"
                      title="移入回收站"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

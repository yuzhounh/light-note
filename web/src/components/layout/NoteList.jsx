import React from 'react'
import { 
  Search, Plus, Pin, Trash2, RotateCcw, Menu, Calendar, Clock
} from 'lucide-react'

export function NoteList({
  notes,
  activeNoteId,
  onSelectNote,
  onCreateNote,
  searchQuery,
  onSearchChange,
  currentView,
  currentNotebookName,
  onOpenSidebar,
  onTogglePin,
  onSoftDelete,
  onRestoreNote,
  onPermanentDelete,
  isMobile
}) {
  function formatDate(isoString) {
    if (!isoString) return ''
    const date = new Date(isoString)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    return `${date.getMonth() + 1}月${date.getDate()}日`
  }

  return (
    <div className="flex flex-col h-full w-full bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 select-none">
      {/* Top Search & Actions Bar */}
      <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 space-y-2">
        <div className="flex items-center gap-2">
          {isMobile && (
            <button
              onClick={onOpenSidebar}
              className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
            >
              <Menu size={18} />
            </button>
          )}

          {/* Search Box */}
          <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 bg-zinc-100 dark:bg-zinc-800/70 rounded-lg text-xs">
            <Search size={14} className="text-zinc-400 shrink-0" />
            <input
              type="text"
              placeholder="搜索标题或正文..."
              value={searchQuery}
              onChange={e => onSearchChange(e.target.value)}
              className="w-full bg-transparent outline-none text-zinc-800 dark:text-zinc-200 placeholder-zinc-400"
            />
          </div>

          {/* New Note Button (if not in trash) */}
          {currentView !== 'trash' && (
            <button
              onClick={onCreateNote}
              className="flex items-center justify-center p-1.5 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white rounded-lg transition shadow-sm"
              title="新建笔记 (Ctrl+N)"
            >
              <Plus size={18} />
            </button>
          )}
        </div>

        {/* View Title & Note Count */}
        <div className="flex items-center justify-between px-1 text-xs text-zinc-500">
          <span className="font-semibold text-zinc-700 dark:text-zinc-300 truncate">
            {currentView === 'trash' ? '回收站' : (currentNotebookName || '全部笔记')}
          </span>
          <span>{notes.length} 篇</span>
        </div>
      </div>

      {/* Note Cards List */}
      <div className="flex-1 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800/50">
        {notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-zinc-400 text-xs text-center p-4">
            <p>暂无相关笔记</p>
            {currentView !== 'trash' && (
              <button
                onClick={onCreateNote}
                className="mt-2 text-amber-500 hover:underline"
              >
                点击新建第一篇
              </button>
            )}
          </div>
        ) : (
          notes.map(note => {
            const isSelected = note.id === activeNoteId
            return (
              <div
                key={note.id}
                onClick={() => onSelectNote(note.id)}
                className={`group relative p-3 cursor-pointer transition ${
                  isSelected
                    ? 'bg-amber-500/10 dark:bg-amber-500/15 border-l-4 border-amber-500'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40 border-l-4 border-transparent'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h4 className={`text-xs font-medium truncate ${
                    note.title ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 italic'
                  }`}>
                    {note.title || '无标题笔记'}
                  </h4>

                  {note.is_pinned === 1 && currentView !== 'trash' && (
                    <Pin size={12} className="text-amber-500 shrink-0 fill-amber-500" />
                  )}
                </div>

                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed mb-1.5">
                  {note.body_text || '无附加正文...'}
                </p>

                <div className="flex items-center justify-between text-[10px] text-zinc-400">
                  <span>{formatDate(note.updated_at)}</span>

                  {/* Quick Card Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                    {currentView === 'trash' ? (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); onRestoreNote(note.id) }}
                          className="p-1 hover:text-emerald-600 rounded"
                          title="恢复此笔记"
                        >
                          <RotateCcw size={12} />
                        </button>
                        <button
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            if (confirm('确定永久删除该笔记吗？此操作无法撤销。')) {
                              onPermanentDelete(note.id)
                            }
                          }}
                          className="p-1 hover:text-rose-600 rounded"
                          title="彻底删除"
                        >
                          <Trash2 size={12} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); onTogglePin(note.id) }}
                          className="p-1 hover:text-amber-600 rounded"
                          title={note.is_pinned ? '取消置顶' : '置顶笔记'}
                        >
                          <Pin size={12} className={note.is_pinned ? 'fill-current' : ''} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); onSoftDelete(note.id) }}
                          className="p-1 hover:text-rose-600 rounded"
                          title="移入回收站"
                        >
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

import React, { useState } from 'react'
import { 
  Book, BookOpen, Plus, Trash2, Pin, Folder, Moon, Sun, 
  X, Check, ChevronRight
} from 'lucide-react'

export function Sidebar({
  notebooks,
  currentNotebookId,
  currentView,
  onSelectNotebook,
  onSelectView,
  onCreateNotebook,
  onDeleteNotebook,
  theme,
  onToggleTheme,
  onCloseMobile,
  isMobile
}) {
  const [isAdding, setIsAdding] = useState(false)
  const [newNotebookName, setNewNotebookName] = useState('')

  function handleCreate(e) {
    e.preventDefault()
    if (newNotebookName.trim()) {
      onCreateNotebook(newNotebookName.trim())
      setNewNotebookName('')
      setIsAdding(false)
    }
  }

  return (
    <div className="flex flex-col h-full w-full bg-zinc-100 dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 select-none">
      {/* App Header */}
      <div className="flex items-center justify-between p-3.5 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center text-amber-500 font-bold text-sm">
            LN
          </div>
          <span className="font-semibold text-sm tracking-wide text-zinc-800 dark:text-zinc-200">
            LightNote
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onToggleTheme}
            className="p-1.5 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition"
            title="切换深色/浅色模式"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          
          {isMobile && (
            <button
              onClick={onCloseMobile}
              className="p-1.5 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 transition"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Main Navigation Views */}
      <div className="p-2 space-y-0.5">
        <button
          onClick={() => { onSelectView('all'); if (isMobile) onCloseMobile() }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition ${
            currentView === 'all' && !currentNotebookId
              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 font-semibold'
              : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/70'
          }`}
        >
          <BookOpen size={16} />
          <span>全部笔记</span>
        </button>

        <button
          onClick={() => { onSelectView('pinned'); if (isMobile) onCloseMobile() }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition ${
            currentView === 'pinned'
              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 font-semibold'
              : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/70'
          }`}
        >
          <Pin size={16} />
          <span>已置顶</span>
        </button>

        <button
          onClick={() => { onSelectView('trash'); if (isMobile) onCloseMobile() }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition ${
            currentView === 'trash'
              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 font-semibold'
              : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/70'
          }`}
        >
          <Trash2 size={16} />
          <span>回收站</span>
        </button>
      </div>

      {/* Notebooks Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <span className="text-[11px] font-semibold tracking-wider text-zinc-400 dark:text-zinc-500 uppercase">
          笔记本
        </span>
        <button
          onClick={() => setIsAdding(true)}
          className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition"
          title="新建笔记本"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* New Notebook Inline Form */}
      {isAdding && (
        <form onSubmit={handleCreate} className="px-2 pb-2">
          <div className="flex items-center gap-1 bg-white dark:bg-zinc-900 border border-amber-500/50 rounded-md p-1 shadow-sm">
            <Folder size={14} className="text-amber-500 shrink-0 ml-1" />
            <input
              type="text"
              autoFocus
              placeholder="笔记本名称"
              value={newNotebookName}
              onChange={e => setNewNotebookName(e.target.value)}
              className="w-full text-xs bg-transparent outline-none text-zinc-800 dark:text-zinc-200 px-1"
            />
            <button
              type="submit"
              className="p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 rounded"
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"
            >
              <X size={14} />
            </button>
          </div>
        </form>
      )}

      {/* Notebook List */}
      <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
        {notebooks.map(nb => {
          const isActive = currentNotebookId === nb.id && currentView === 'all'
          return (
            <div
              key={nb.id}
              onClick={() => {
                onSelectNotebook(nb.id)
                if (isMobile) onCloseMobile()
              }}
              className={`group flex items-center justify-between px-3 py-1.5 rounded-lg text-xs cursor-pointer transition ${
                isActive
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 font-semibold'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/70'
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                <Folder size={15} className={isActive ? 'text-amber-500' : 'text-zinc-400'} />
                <span className="truncate">{nb.name}</span>
              </div>
              
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm(`确定删除笔记本“${nb.name}”吗？其内部的笔记仍会保留。`)) {
                    onDeleteNotebook(nb.id)
                  }
                }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:text-rose-500 rounded transition"
                title="删除笔记本"
              >
                <Trash2 size={12} />
              </button>
            </div>
          )
        })}
      </div>

      {/* Footer Info */}
      <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-400 text-center">
        LightNote Web v1.0 • 本地优先
      </div>
    </div>
  )
}

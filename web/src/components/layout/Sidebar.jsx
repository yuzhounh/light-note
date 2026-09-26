import React, { useState } from 'react'
import { 
  FileText, Folder, Book, Plus, Settings, ChevronDown, ChevronRight, X, Check
} from 'lucide-react'

export function Sidebar({
  notebooks,
  currentNotebookId,
  currentView,
  onSelectNotebook,
  onSelectView,
  onCreateNotebook,
  onDeleteNotebook,
  onCreateNote,
  theme,
  onToggleTheme,
  onCloseMobile,
  isMobile
}) {
  const [isGroupOpen, setIsGroupOpen] = useState(true)
  const [isAddingNotebook, setIsAddingNotebook] = useState(false)
  const [newNotebookName, setNewNotebookName] = useState('')

  function handleCreateNotebook(e) {
    e.preventDefault()
    if (newNotebookName.trim()) {
      onCreateNotebook(newNotebookName.trim())
      setNewNotebookName('')
      setIsAddingNotebook(false)
    }
  }

  return (
    <div className="flex flex-col h-full w-full bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 select-none">
      {/* Top Action: Large '+ 新建笔记' pill button */}
      <div className="p-3">
        <button
          onClick={() => {
            onCreateNote()
            if (isMobile) onCloseMobile()
          }}
          className="w-full flex items-center gap-2.5 px-4 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700/80 rounded-full shadow-sm hover:shadow hover:bg-zinc-50 dark:hover:bg-zinc-800/80 active:scale-[0.98] transition cursor-pointer"
        >
          <div className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
            +
          </div>
          <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 tracking-wide">
            新建笔记
          </span>
        </button>
      </div>

      {/* Main Navigation List */}
      <div className="flex-1 overflow-y-auto px-2 space-y-1">
        {/* 全部笔记 */}
        <button
          onClick={() => {
            onSelectView('all')
            if (isMobile) onCloseMobile()
          }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-normal transition text-left cursor-pointer ${
            currentView === 'all' && !currentNotebookId
              ? 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-900 dark:text-white font-medium'
              : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900'
          }`}
        >
          <FileText size={15} className="text-zinc-500 dark:text-zinc-400 shrink-0" />
          <span>全部笔记</span>
        </button>

        {/* 笔记本组 (可展开/折叠) */}
        <div>
          <div
            onClick={() => setIsGroupOpen(!isGroupOpen)}
            className="flex items-center justify-between px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded-lg cursor-pointer transition"
          >
            <div className="flex items-center gap-2">
              <Folder size={15} className="text-zinc-500 dark:text-zinc-400 shrink-0" />
              <span>笔记本组</span>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setIsAddingNotebook(true)
                setIsGroupOpen(true)
              }}
              className="p-0.5 hover:text-zinc-900 dark:hover:text-white"
              title="新建笔记本"
            >
              <Plus size={13} />
            </button>
          </div>

          {/* Sub Notebook Items */}
          {isGroupOpen && (
            <div className="pl-6 pr-1 space-y-0.5 mt-0.5">
              {notebooks.map(nb => {
                const isActive = currentNotebookId === nb.id && currentView === 'all'
                return (
                  <div
                    key={nb.id}
                    onClick={() => {
                      onSelectNotebook(nb.id)
                      if (isMobile) onCloseMobile()
                    }}
                    className={`group flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition ${
                      isActive
                        ? 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-900 dark:text-white font-medium'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Book size={14} className={isActive ? 'text-zinc-800 dark:text-zinc-200' : 'text-zinc-400'} />
                      <span className="truncate">{nb.name}</span>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm(`确定删除笔记本“${nb.name}”？笔记仍会保留。`)) {
                          onDeleteNotebook(nb.id)
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-rose-500 rounded text-zinc-400"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )
              })}

              {/* Add notebook inline form */}
              {isAddingNotebook && (
                <form onSubmit={handleCreateNotebook} className="pt-1">
                  <div className="flex items-center gap-1 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded p-1">
                    <input
                      type="text"
                      autoFocus
                      placeholder="笔记本名"
                      value={newNotebookName}
                      onChange={e => setNewNotebookName(e.target.value)}
                      className="w-full text-xs bg-transparent outline-none text-zinc-800 dark:text-zinc-200 px-1"
                    />
                    <button type="submit" className="p-0.5 text-emerald-600">
                      <Check size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsAddingNotebook(false)}
                      className="p-0.5 text-zinc-400"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Footer: 'Google 登录' and Settings gear icon */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 text-xs text-zinc-600 dark:text-zinc-400">
        <button
          onClick={() => alert('轻量版网页端已开启本地存储；可在后续直接接入 Firebase Google OAuth 登录')}
          className="hover:text-zinc-900 dark:hover:text-white transition cursor-pointer"
        >
          Google 登录
        </button>

        <div className="flex items-center gap-1">
          <button
            onClick={onToggleTheme}
            className="p-1 hover:text-zinc-900 dark:hover:text-white transition rounded cursor-pointer"
            title="切换明暗主题"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

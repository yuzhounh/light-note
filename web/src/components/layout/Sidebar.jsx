import React, { useState } from 'react'
import { 
  FileText, Folder, Book, Plus, Settings, ChevronDown, ChevronRight, X, Check, LogOut, Trash2, Sun, Moon
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
  onOpenSettings,
  currentUser,
  onLoginGoogle,
  onLogout,
  theme,
  onToggleTheme,
  onCloseMobile,
  isMobile
}) {
  const [isGroupOpen, setIsGroupOpen] = useState(true)
  const [isAddingNotebook, setIsAddingNotebook] = useState(false)
  const [newNotebookName, setNewNotebookName] = useState('')
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false)

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
      {/* Top Action: '+ 新建笔记' pill button */}
      <div className="px-3 pt-3 pb-2">
        <button
          onClick={() => {
            onCreateNote()
            if (isMobile) onCloseMobile()
          }}
          className="w-full h-[36px] relative flex items-center bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700/80 rounded-full shadow-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/80 active:scale-[0.98] transition cursor-pointer"
        >
          {/* Green circle: outer cap radius is 18px. Circle is 26px, left margin is 5px. Concentric and balanced */}
          <div className="w-[26px] h-[26px] rounded-full bg-[#00b87a] flex items-center justify-center shrink-0 ml-[5px]">
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-white" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          <span className="ml-2.5 text-sm font-medium text-zinc-800 dark:text-zinc-200 tracking-wide">
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
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-normal transition text-left cursor-pointer ${
            currentView === 'all' && !currentNotebookId
              ? 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-900 dark:text-white font-medium'
              : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900'
          }`}
        >
          <FileText size={16} className="text-zinc-500 dark:text-zinc-400 shrink-0" />
          <span>全部笔记</span>
        </button>

        {/* 笔记本组 (可展开/折叠) */}
        <div>
          <div
            onClick={() => setIsGroupOpen(!isGroupOpen)}
            className="flex items-center justify-between px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded-lg cursor-pointer transition"
          >
            <div className="flex items-center gap-2">
              <Folder size={16} className="text-zinc-500 dark:text-zinc-400 shrink-0" />
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
              <Plus size={14} />
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
                    className={`group flex items-center justify-between px-2.5 py-1.5 rounded-md text-[13.5px] cursor-pointer transition ${
                      isActive
                        ? 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-900 dark:text-white font-medium'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Book size={15} className={isActive ? 'text-zinc-800 dark:text-zinc-200' : 'text-zinc-400'} />
                      <span className="truncate">{nb.name}</span>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm(`确定删除笔记本“${nb.name}”？笔记仍会保留。`)) {
                          onDeleteNotebook(nb.id)
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:text-rose-500 rounded text-zinc-400 transition"
                      title="删除笔记本"
                    >
                      <Trash2 size={14} />
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

      {/* Bottom Footer: User Profile / Google Login and Settings gear icon */}
      <div className="relative flex items-center justify-between px-3.5 py-2.5 border-t border-zinc-200 dark:border-zinc-800 text-[13.5px] text-zinc-600 dark:text-zinc-400">
        {currentUser ? (
          <button
            onClick={() => setIsProfileModalOpen(!isProfileModalOpen)}
            className="flex items-center gap-2 max-w-[155px] hover:opacity-80 transition cursor-pointer text-left min-w-0"
            title="点击管理账号"
          >
            {currentUser.photoURL ? (
              <img
                src={currentUser.photoURL}
                alt=""
                className="w-6 h-6 rounded-full object-cover shrink-0 ring-1 ring-zinc-300 dark:ring-zinc-700"
                onError={e => {
                  e.currentTarget.style.display = 'none'
                  if (e.currentTarget.nextSibling) {
                    e.currentTarget.nextSibling.style.display = 'flex'
                  }
                }}
              />
            ) : null}
            <div 
              className={`w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-medium text-[11px] shrink-0 ${currentUser.photoURL ? 'hidden' : 'flex'}`}
            >
              {currentUser.displayName ? currentUser.displayName.slice(0, 1).toUpperCase() : 'U'}
            </div>
            <span className="truncate text-[13.5px] font-normal text-zinc-800 dark:text-zinc-200">
              {currentUser.displayName || currentUser.email}
            </span>
          </button>
        ) : (
          <button
            onClick={onLoginGoogle}
            className="hover:text-zinc-900 dark:hover:text-white transition cursor-pointer text-[13.5px]"
          >
            Google 登录
          </button>
        )}

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onOpenSettings}
            className="p-1 hover:text-zinc-900 dark:hover:text-white transition rounded cursor-pointer"
            title="设置中心"
          >
            <Settings size={17} />
          </button>
        </div>

        {/* Compact Popover Card anchored right above the username in Column 1 */}
        {isProfileModalOpen && currentUser && (
          <>
            {/* Invisible backdrop to dismiss on click outside */}
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setIsProfileModalOpen(false)} 
            />

            <div 
              className="absolute bottom-full left-2.5 right-2.5 mb-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl p-3 z-50 flex flex-col gap-2.5 animate-in fade-in slide-in-from-bottom-2 duration-150 select-none"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-2.5">
                {currentUser.photoURL ? (
                  <img
                    src={currentUser.photoURL}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover shrink-0 ring-1 ring-zinc-300 dark:ring-zinc-700"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-semibold text-xs shrink-0">
                    {currentUser.displayName ? currentUser.displayName.slice(0, 1).toUpperCase() : 'U'}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 truncate">
                    {currentUser.displayName || 'LightNote 用户'}
                  </div>
                  <div className="text-[10px] text-zinc-400 truncate" title={currentUser.email}>
                    {currentUser.email || ''}
                  </div>
                </div>
              </div>

              <div className="border-t border-zinc-100 dark:border-zinc-800" />

              {/* Theme mode switcher segmented control */}
              <div className="flex items-center p-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => { if (theme !== 'light' && onToggleTheme) onToggleTheme() }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1 rounded-md text-[11px] font-medium transition cursor-pointer ${
                    theme === 'light'
                      ? 'bg-white text-zinc-900 shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                  title="浅色模式"
                >
                  <Sun size={12} />
                  <span>浅色</span>
                </button>
                <button
                  type="button"
                  onClick={() => { if (theme !== 'dark' && onToggleTheme) onToggleTheme() }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1 rounded-md text-[11px] font-medium transition cursor-pointer ${
                    theme === 'dark'
                      ? 'bg-zinc-700 text-zinc-100 shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                  title="深色模式"
                >
                  <Moon size={12} />
                  <span>深色</span>
                </button>
              </div>

              <div className="border-t border-zinc-100 dark:border-zinc-800" />

              <button
                onClick={() => {
                  setIsProfileModalOpen(false)
                  if (onLogout) onLogout()
                }}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 bg-rose-50 hover:bg-rose-100/80 dark:bg-rose-950/40 dark:hover:bg-rose-950/70 text-rose-600 dark:text-rose-400 rounded-lg text-xs font-medium transition cursor-pointer"
              >
                <LogOut size={13} />
                <span>退出登录</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

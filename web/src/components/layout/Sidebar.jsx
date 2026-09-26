import React, { useState } from 'react'
import { 
  FileText, Folder, Book, Plus, Settings, ChevronDown, ChevronRight, X, Check
} from 'lucide-react'
import { UserProfileModal } from '../modals/UserProfileModal'

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
          className="w-full h-[34px] relative flex items-center bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700/80 rounded-full shadow-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/80 active:scale-[0.98] transition cursor-pointer"
        >
          {/* Green circle: outer cap radius is 17px. Circle is 24px, left margin is 5px. Center = (17, 17). 100% concentric */}
          <div className="w-[24px] h-[24px] rounded-full bg-[#00b87a] flex items-center justify-center shrink-0 ml-[5px]">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-white" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          <span className="ml-2.5 text-xs font-medium text-zinc-800 dark:text-zinc-200 tracking-wide">
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

      {/* Bottom Footer: User Profile / Google Login and Settings gear icon */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-t border-zinc-200 dark:border-zinc-800 text-xs text-zinc-600 dark:text-zinc-400">
        {currentUser ? (
          <button
            onClick={() => setIsProfileModalOpen(true)}
            className="flex items-center gap-2 max-w-[145px] hover:opacity-80 transition cursor-pointer text-left min-w-0"
            title="查看账号详情与退出登录"
          >
            {currentUser.photoURL ? (
              <img
                src={currentUser.photoURL}
                alt=""
                className="w-5 h-5 rounded-full object-cover shrink-0 ring-1 ring-zinc-300 dark:ring-zinc-700"
                onError={e => {
                  e.currentTarget.style.display = 'none'
                  if (e.currentTarget.nextSibling) {
                    e.currentTarget.nextSibling.style.display = 'flex'
                  }
                }}
              />
            ) : null}
            <div 
              className={`w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-medium text-[10px] shrink-0 ${currentUser.photoURL ? 'hidden' : 'flex'}`}
            >
              {currentUser.displayName ? currentUser.displayName.slice(0, 1).toUpperCase() : 'U'}
            </div>
            <span className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
              {currentUser.displayName || currentUser.email}
            </span>
          </button>
        ) : (
          <button
            onClick={onLoginGoogle}
            className="hover:text-zinc-900 dark:hover:text-white transition cursor-pointer"
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
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* Account Profile & Logout Modal */}
      <UserProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        user={currentUser}
        onLogout={onLogout}
      />
    </div>
  )
}

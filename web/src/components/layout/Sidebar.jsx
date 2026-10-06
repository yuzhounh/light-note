import React, { useState } from 'react'
import { 
  FileText, Folder, Book, Plus, Settings, ChevronDown, ChevronRight, X, Check, LogOut, Trash2, Sun, Moon, RefreshCw, Search
} from 'lucide-react'

export function Sidebar({
  searchQuery = '',
  onSearchChange,
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
  isMobile,
  syncStatus,
  onSync
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
    <div className="note-sidebar flex flex-col h-full w-full bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 select-none">
      {isMobile && (
        <div className="flex items-center justify-between px-4 min-h-[56px] border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="LightNote" className="w-6 h-6 rounded-md shadow-xs shrink-0" />
            <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 tracking-tight">LightNote</span>
          </div>
          <button
            onClick={onCloseMobile}
            aria-label="关闭菜单"
            className="w-10 h-10 min-w-10 min-h-10 rounded-full border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 flex items-center justify-center text-zinc-500 hover:text-emerald-600 hover:border-emerald-500 transition cursor-pointer shadow-xs"
            title="关闭"
          >
            <X size={20} />
          </button>
        </div>
      )}
      {/* Mobile Drawer Search Bar (Folded from top) */}
      {isMobile && onSearchChange && (
        <div className="px-3 pt-3 pb-1">
          <div className="relative flex items-center">
            <input
              type="text"
              placeholder="搜索标题和正文..."
              value={searchQuery}
              onChange={e => onSearchChange(e.target.value)}
              className="w-full pl-9 pr-8 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-transparent focus:border-emerald-500 dark:focus:border-emerald-500 text-xs text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 outline-none transition"
            />
            <Search size={15} className="absolute left-3 text-zinc-400 pointer-events-none" />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="absolute right-2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
                title="清除搜索"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Top Action: '+ 新建笔记'（无底色，悬停时显示背景，与下方导航行等高） */}
      <div className="px-2 pt-2 pb-2">
        <button
          onClick={() => {
            onCreateNote()
            if (isMobile) onCloseMobile()
          }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-normal text-zinc-800 dark:text-zinc-200 hover:bg-[#e4e7eb] dark:hover:bg-[#363b43] active:opacity-80 transition text-left cursor-pointer`}
        >
          <Plus size={16} strokeWidth={1.6} className="shrink-0" />
          <span>新建笔记</span>
        </button>
      </div>

      {/* Main Navigation List */}
      <div className="sidebar-navigation flex-1 min-h-0 overflow-y-auto px-2 space-y-1">
        {/* 全部笔记 */}
        <button
          onClick={() => {
            onSelectView('all')
            if (isMobile) onCloseMobile()
          }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-normal transition text-left cursor-pointer ${
            currentView === 'all' && !currentNotebookId
              ? 'bg-[#d3f0e3] dark:bg-[#234a3f] text-[#007f55] dark:text-emerald-400 font-medium'
              : 'text-zinc-700 dark:text-zinc-300 hover:bg-[#e4e7eb] dark:hover:bg-[#363b43]'
          }`}
        >
          <FileText size={16} className={`shrink-0 ${currentView === 'all' && !currentNotebookId ? '' : 'text-zinc-500 dark:text-zinc-400'}`} />
          <span>全部笔记</span>
        </button>

        {/* 笔记本组 (可展开/折叠) */}
        <div>
          <div
            onClick={() => setIsGroupOpen(!isGroupOpen)}
            className="flex items-center justify-between px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-[#e4e7eb] dark:hover:bg-[#363b43] rounded-lg cursor-pointer transition"
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
              className="p-1 min-w-[28px] min-h-[28px] flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/10 hover:text-zinc-900 dark:hover:text-white"
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
                    className={`notebook-row group flex items-center justify-between px-2.5 py-1.5 rounded-md text-[13.5px] cursor-pointer transition ${
                      isActive
                        ? 'bg-[#d3f0e3] dark:bg-[#234a3f] text-[#007f55] dark:text-emerald-400 font-medium'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-[#e4e7eb] dark:hover:bg-[#363b43]'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Book size={15} className={isActive ? '' : 'text-zinc-400'} />
                      <span className="truncate">{nb.name}</span>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm(`确定删除笔记本“${nb.name}”？笔记仍会保留。`)) {
                          onDeleteNotebook(nb.id)
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 min-w-[28px] min-h-[28px] flex items-center justify-center hover:text-rose-500 rounded text-zinc-400 transition"
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
                    <button type="submit" aria-label="创建笔记本" className="p-0.5 text-emerald-600">
                      <Check size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsAddingNotebook(false)}
                      aria-label="取消新建笔记本"
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
      {isMobile ? (
        <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 flex flex-col gap-2 shrink-0 bg-white dark:bg-zinc-950">
          {/* Row 1: 外观主题 */}
          <div className="flex items-center justify-between min-h-[48px] px-1">
            <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">外观主题</span>
            <button
              type="button"
              onClick={onToggleTheme}
              className="w-10 h-10 min-w-10 min-h-10 rounded-full border border-zinc-200 dark:border-zinc-700/80 bg-zinc-50 dark:bg-zinc-900 hover:border-emerald-500 text-zinc-700 dark:text-zinc-200 flex items-center justify-center cursor-pointer transition shadow-xs"
              title={theme === 'dark' ? '切换为浅色主题' : '切换为深色主题'}
              aria-label="切换外观主题"
            >
              {theme === 'dark' ? <Moon size={20} /> : <Sun size={20} />}
            </button>
          </div>

          {/* Row 2: 账号/设置 */}
          {currentUser ? (
            <div className="flex items-center justify-between min-h-[48px] px-1 border-t border-zinc-100 dark:border-zinc-800/80 pt-1">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="w-8 h-8 rounded-full bg-[#00b87a] text-white font-bold flex items-center justify-center text-xs shrink-0">
                  {(currentUser.displayName || currentUser.email || 'U')[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">{currentUser.displayName || '已登录'}</div>
                  <div className="text-[10px] text-zinc-400 truncate">{currentUser.email || ''}</div>
                </div>
              </div>
              <button
                onClick={onLogout}
                className="w-9 h-9 rounded-full border border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer transition shrink-0"
                title="退出登录"
                aria-label="退出登录"
              >
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <button
              onClick={onLoginGoogle}
              className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-full bg-zinc-100 hover:bg-[#e4e7eb] text-zinc-800 border border-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-100 dark:border-zinc-700/80 dark:hover:border-zinc-600 text-xs font-semibold transition cursor-pointer"
            >
              <span>登录 Google 账号</span>
            </button>
          )}
        </div>
      ) : (
      <div className="relative shrink-0 flex items-center justify-between px-3.5 py-2.5 border-t border-zinc-200 dark:border-zinc-800 text-[13.5px] text-zinc-600 dark:text-zinc-400">
        {currentUser ? (
          <button
            onClick={() => setIsProfileModalOpen(!isProfileModalOpen)}
            className="flex items-center gap-2 max-w-[155px] px-1.5 py-1 -ml-1.5 rounded-md hover:bg-[#e4e7eb] dark:hover:bg-[#363b43] transition cursor-pointer text-left min-w-0"
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
            className="flex items-center min-h-[36px] px-2.5 py-1 rounded-md hover:bg-[#e4e7eb] dark:hover:bg-[#363b43] hover:text-zinc-900 dark:hover:text-white transition cursor-pointer text-[13.5px]"
          >
            Google 登录
          </button>
        )}

        <div className="flex items-center gap-1 shrink-0">
          {currentUser && (
            <button
              onClick={onSync}
              className={`p-1.5 hover:bg-[#e4e7eb] dark:hover:bg-[#363b43] hover:text-zinc-900 dark:hover:text-white transition rounded-md cursor-pointer ${
                syncStatus?.status === 'syncing' 
                  ? 'text-amber-500' 
                  : syncStatus?.status === 'error' 
                  ? 'text-rose-500' 
                  : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
              title={
                syncStatus?.status === 'syncing'
                  ? '正在同步...'
                  : syncStatus?.status === 'error'
                  ? `同步异常: ${syncStatus.error || ''} (点击重试)`
                  : `已同步${syncStatus?.lastSyncedAt ? ' (' + new Date(syncStatus.lastSyncedAt).toLocaleTimeString() + ')' : ''} (点击立即同步)`
              }
            >
              <RefreshCw size={15} className={syncStatus?.status === 'syncing' ? 'animate-spin' : ''} />
            </button>
          )}
          <button
            onClick={onOpenSettings}
            className="p-1.5 hover:bg-[#e4e7eb] dark:hover:bg-[#363b43] hover:text-zinc-900 dark:hover:text-white transition rounded-md cursor-pointer"
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
              className="absolute bottom-full left-2.5 right-2.5 mb-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl p-3 z-50 flex flex-col gap-2.5 animate-in fade-in slide-in-from-bottom-2 duration-150 select-none"
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

              <button
                onClick={() => {
                  setIsProfileModalOpen(false)
                  if (onLogout) onLogout()
                }}
                className="w-full flex items-center gap-2 py-1.5 px-2 text-zinc-700 dark:text-zinc-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg text-xs transition cursor-pointer"
              >
                <LogOut size={13} />
                <span>退出登录</span>
              </button>
            </div>
          </>
        )}
      </div>
      )}
    </div>
  )
}

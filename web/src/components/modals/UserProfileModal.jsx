import React from 'react'
import { X, LogOut, CheckCircle2, User, Shield } from 'lucide-react'

export function UserProfileModal({ isOpen, onClose, user, onLogout }) {
  if (!isOpen || !user) return null

  function handleLogoutClick() {
    onClose()
    if (onLogout) onLogout()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs select-none">
      <div 
        className="w-full max-w-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            账号管理
          </span>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* User Card Info */}
        <div className="flex flex-col items-center px-6 pt-2 pb-6 text-center">
          {/* Avatar */}
          <div className="relative mb-3">
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt={user.displayName || 'User Avatar'}
                className="w-16 h-16 rounded-full object-cover ring-2 ring-emerald-500/30 shadow-md"
                onError={e => {
                  e.currentTarget.style.display = 'none'
                  e.currentTarget.nextSibling.style.display = 'flex'
                }}
              />
            ) : null}
            <div 
              className={`w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-semibold text-xl shadow-md ${user.photoURL ? 'hidden' : 'flex'}`}
            >
              {user.displayName ? user.displayName.slice(0, 1).toUpperCase() : <User size={28} />}
            </div>
            <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full border-2 border-white dark:border-zinc-900 flex items-center justify-center text-white" title="已登录">
              <CheckCircle2 size={13} />
            </div>
          </div>

          {/* Name & Email */}
          <h3 className="font-semibold text-base text-zinc-900 dark:text-zinc-100">
            {user.displayName || 'LightNote 用户'}
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            {user.email || '未绑定邮箱'}
          </p>

          {/* Status Badge */}
          <div className="flex items-center gap-1.5 mt-3 px-3 py-1 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 rounded-full text-[11px] text-emerald-700 dark:text-emerald-400">
            <Shield size={12} />
            <span>Google 账号云端同步中</span>
          </div>

          {/* Action Buttons */}
          <div className="w-full mt-6 space-y-2">
            <button
              onClick={handleLogoutClick}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-rose-50 hover:bg-rose-100/80 dark:bg-rose-950/30 dark:hover:bg-rose-950/60 border border-rose-200 dark:border-rose-900/50 text-rose-600 dark:text-rose-400 rounded-xl text-xs font-medium transition cursor-pointer active:scale-[0.98]"
            >
              <LogOut size={15} />
              <span>退出登录</span>
            </button>

            <button
              onClick={onClose}
              className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 rounded-lg transition cursor-pointer"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

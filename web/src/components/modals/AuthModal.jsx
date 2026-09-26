import React, { useState } from 'react'
import { X, Mail, Lock, ShieldCheck, CheckCircle2 } from 'lucide-react'

export function AuthModal({ isOpen, onClose }) {
  const [authMode, setAuthMode] = useState('google') // 'google' | 'email'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')

  if (!isOpen) return null

  function handleGoogleSignIn() {
    setLoading(true)
    setStatusMessage('正在连接 Google 身份验证服务...')
    // Simulated / Firebase trigger
    setTimeout(() => {
      setLoading(false)
      setStatusMessage('提示：当前为离线演示模式。在设置中心配置真实 Firebase 参数后即可一键登录 Google 并自动同步笔记。')
    }, 800)
  }

  function handleEmailAuth(e) {
    e.preventDefault()
    if (!email || !password) return
    setLoading(true)
    setStatusMessage('正在验证账号信息...')
    setTimeout(() => {
      setLoading(false)
      setStatusMessage('提示：请在设置中心中配置您的 Firebase Project ID 与 Web API Key，即可开启邮箱多端漫游。')
    }, 800)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs select-none">
      <div 
        className="w-full max-w-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="LightNote" className="w-5 h-5" />
            <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
              登录 LightNote
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 text-center leading-relaxed">
            登录后，您的笔记、笔记本与附件将自动在网页端、安卓端与 Windows 客户端之间保持实时同步。
          </p>

          {/* Google Official Styled Sign-In Button */}
          <button
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 py-2.5 px-4 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-750 hover:shadow-sm rounded-xl text-xs font-medium text-zinc-700 dark:text-zinc-200 transition cursor-pointer active:scale-[0.98]"
          >
            {/* Google Multi-Color SVG Logo */}
            <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>使用 Google 账号继续</span>
          </button>

          {/* Divider */}
          <div className="relative flex items-center justify-center">
            <div className="border-t border-zinc-200 dark:border-zinc-800 w-full" />
            <span className="bg-white dark:bg-zinc-900 px-2 text-[11px] text-zinc-400 absolute">
              或使用邮箱
            </span>
          </div>

          {/* Email / Password Form */}
          <form onSubmit={handleEmailAuth} className="space-y-2.5">
            <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700/80 rounded-lg text-xs">
              <Mail size={14} className="text-zinc-400 shrink-0" />
              <input
                type="email"
                placeholder="电子邮箱地址"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-transparent outline-none text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400"
              />
            </div>

            <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700/80 rounded-lg text-xs">
              <Lock size={14} className="text-zinc-400 shrink-0" />
              <input
                type="password"
                placeholder="密码"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-transparent outline-none text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 rounded-lg text-xs font-medium transition cursor-pointer active:scale-[0.98]"
            >
              登录 / 注册
            </button>
          </form>

          {/* Status Message */}
          {statusMessage && (
            <div className="p-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-lg text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
              {statusMessage}
            </div>
          )}

          <div className="flex items-center justify-center gap-1.5 text-[10px] text-zinc-400 pt-1">
            <ShieldCheck size={13} className="text-emerald-500" />
            <span>端到端加密与用户级隔离</span>
          </div>
        </div>
      </div>
    </div>
  )
}

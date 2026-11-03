import React, { useState, useEffect } from 'react'
import { X, Download, Upload, Trash2, Sun, Moon, Database, Globe, Sliders } from 'lucide-react'
import { db } from '../../core/db/database'
import { NotesRepository } from '../../core/db/notesRepository'
import { APP_DISPLAY_VERSION } from '../../core/version'
import { useBackDismiss } from '../../hooks/useBackDismiss'
import { getLang, setLang } from '../../i18n'

function readMarkdownAutoFormat() {
  try {
    return localStorage.getItem('lightnote.markdownAutoFormat') !== 'false'
  } catch {
    return true
  }
}

export function SettingsModal({
  isOpen,
  onClose,
  theme,
  onChangeTheme,
  onDataImported
}) {
  const [activeTab, setActiveTab] = useState('general') // 'general' | 'data'
  const [markdownAutoFormat, setMarkdownAutoFormat] = useState(readMarkdownAutoFormat)
  const [isExporting, setIsExporting] = useState(false)
  const [msg, setMsg] = useState('')
  const [lang, setLangState] = useState(getLang())

  useEffect(() => {
    const onLangChanged = (e) => {
      if (e?.detail) setLangState(e.detail)
    }
    window.addEventListener('lightnote:lang-changed', onLangChanged)
    return () => window.removeEventListener('lightnote:lang-changed', onLangChanged)
  }, [])

  useBackDismiss(isOpen, onClose, 55)

  if (!isOpen) return null

  // Export all notebooks & notes as JSON
  async function handleExport() {
    setIsExporting(true)
    try {
      const notebooks = await db.notebooks.toArray()
      const notes = await db.notes.toArray()
      const backupData = {
        version: '1.0',
        exported_at: new Date().toISOString(),
        notebooks,
        notes,
      }

      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `LightNote_Backup_${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setMsg('导出成功！')
    } catch (e) {
      setMsg('导出失败：' + e.message)
    } finally {
      setIsExporting(false)
    }
  }

  // Import JSON backup
  async function handleImport(e) {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (Array.isArray(data.notebooks) && Array.isArray(data.notes)) {
        await db.notebooks.bulkPut(data.notebooks)
        await db.notes.bulkPut(data.notes)
        setMsg(`导入成功：${data.notebooks.length} 个笔记本，${data.notes.length} 篇笔记。`)
        if (onDataImported) onDataImported()
      } else {
        setMsg('导入失败：无效的 LightNote 备份文件格式。')
      }
    } catch (err) {
      setMsg('解析文件失败：' + err.message)
    }
  }

  // Clear Trash
  async function handleEmptyTrash() {
    if (confirm('确定清空回收站中的所有笔记吗？此操作无法撤销。')) {
      await NotesRepository.emptyTrash()
      setMsg('回收站已清空。')
      if (onDataImported) onDataImported()
    }
  }

  return (
    <div className="app-modal fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/70 backdrop-blur-sm select-none">
      <div 
        className="app-dialog w-full max-w-xl max-h-[85vh] sm:h-[480px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-500 rounded-xl shadow-2xl dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),0_25px_60px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col sm:flex-row animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        onClick={e => e.stopPropagation()}
      >
        {/* Mobile Header (Hidden on sm and above) */}
        <div className="flex sm:hidden items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            设置
          </h3>
          <button
            onClick={onClose}
            aria-label="关闭设置"
            className="w-10 h-10 min-w-10 min-h-10 rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex items-center justify-center text-zinc-500 hover:text-emerald-600 hover:border-emerald-500 transition cursor-pointer shadow-xs"
            title="关闭"
          >
            <X size={20} />
          </button>
        </div>

        {/* Mobile Tab Switcher (Hidden on sm and above) */}
        <div className="flex sm:hidden items-center gap-1.5 p-2 bg-zinc-50 dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <button
            onClick={() => { setActiveTab('general'); setMsg('') }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs transition cursor-pointer ${
              activeTab === 'general'
                ? 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold'
                : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/50'
            }`}
          >
            <Sliders size={14} />
            <span>常规</span>
          </button>

          <button
            onClick={() => { setActiveTab('data'); setMsg('') }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs transition cursor-pointer ${
              activeTab === 'data'
                ? 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold'
                : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/50'
            }`}
          >
            <Database size={14} />
            <span>数据与备份</span>
          </button>
        </div>

        {/* Desktop Left Column: Navigation Tabs & Version at bottom (Hidden on mobile) */}
        <div className="hidden sm:flex w-44 bg-zinc-50 dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 flex-col justify-between shrink-0">
          <div className="p-3">
            <h3 className="px-2 pt-1 pb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              设置
            </h3>
            <div className="space-y-1">
              <button
                onClick={() => { setActiveTab('general'); setMsg('') }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition cursor-pointer text-left ${
                  activeTab === 'general'
                    ? 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/50 dark:hover:bg-zinc-900'
                }`}
              >
                <Sliders size={15} />
                <span>常规</span>
              </button>

              <button
                onClick={() => { setActiveTab('data'); setMsg('') }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition cursor-pointer text-left ${
                  activeTab === 'data'
                    ? 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/50 dark:hover:bg-zinc-900'
                }`}
              >
                <Database size={15} />
                <span>数据与备份</span>
              </button>
            </div>
          </div>

          {/* Version at the bottom of left column, matching desktop client */}
          <div className="border-t border-zinc-200 dark:border-zinc-800 px-4 py-3 text-xs text-zinc-400 font-sans select-none">
            {APP_DISPLAY_VERSION}
          </div>
        </div>

        {/* Right Column: Tab Content */}
        <div className="flex-1 flex flex-col bg-white dark:bg-zinc-900 min-w-0 overflow-hidden relative">
          {/* Close button (Desktop floating in top-right corner, mobile in top bar) */}
          <button
            onClick={onClose}
            aria-label="关闭设置"
            className="hidden sm:flex absolute top-3.5 right-3.5 z-10 w-8 h-8 rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-500 transition cursor-pointer shadow-xs"
            title="关闭"
          >
            <X size={16} />
          </button>

          {/* Tab Body */}
          <div className="modal-scroll flex-1 min-h-0 overflow-y-auto px-4 py-3.5 sm:px-6 sm:py-5 text-xs text-zinc-700 dark:text-zinc-300">
            {msg && (
              <div className="p-2.5 bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-md text-zinc-800 dark:text-zinc-200">
                {msg}
              </div>
            )}

            {/* TAB 1: General (常规) */}
            {activeTab === 'general' && (
              <div className="space-y-3.5 pr-8 sm:pr-9">
                <div>
                  <h4 className="text-sm sm:text-base font-semibold text-zinc-900 dark:text-zinc-100">
                    常规
                  </h4>
                  <p className="text-zinc-500 text-[11px] mt-0.5">
                    自定义外观主题、界面语言与快捷排版习惯。
                  </p>
                </div>

                {/* 1. 外观主题 */}
                <div className="pt-0.5">
                  <div>
                    <div className="font-medium text-xs text-zinc-800 dark:text-zinc-200">外观主题</div>
                    <p className="text-zinc-500 text-[11px] mt-0.5">选择浅色明亮或深色护眼外观。</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 pt-1.5">
                    <button
                      type="button"
                      onClick={() => onChangeTheme('light')}
                      className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition cursor-pointer min-w-0 ${
                        theme === 'light'
                          ? 'border-zinc-400 dark:border-zinc-500 bg-zinc-100/70 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium shadow-xs'
                          : 'border-zinc-200 dark:border-zinc-700/80 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      <Sun size={18} className={theme === 'light' ? 'text-zinc-800 dark:text-zinc-200 shrink-0' : 'text-zinc-400 shrink-0'} />
                      <div className="min-w-0">
                        <div className="font-medium text-xs truncate">浅色模式</div>
                        <div className="text-[10px] text-zinc-400 truncate">标准明亮界面</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => onChangeTheme('dark')}
                      className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition cursor-pointer min-w-0 ${
                        theme === 'dark'
                          ? 'border-zinc-400 dark:border-zinc-500 bg-zinc-100/70 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium shadow-xs'
                          : 'border-zinc-200 dark:border-zinc-700/80 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      <Moon size={18} className={theme === 'dark' ? 'text-zinc-800 dark:text-zinc-200 shrink-0' : 'text-zinc-400 shrink-0'} />
                      <div className="min-w-0">
                        <div className="font-medium text-xs truncate">深色模式</div>
                        <div className="text-[10px] text-zinc-400 truncate">暗色护眼界面</div>
                      </div>
                    </button>
                  </div>
                </div>

                {/* 2. 界面语言 */}
                <div className="pt-2.5 border-t border-zinc-100 dark:border-zinc-800">
                  <div>
                    <div className="font-medium text-xs text-zinc-800 dark:text-zinc-200">界面语言</div>
                    <p className="text-zinc-500 text-[11px] mt-0.5">选择软件界面的显示语言。</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 pt-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setLangState('zh')
                        setLang('zh')
                      }}
                      className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition cursor-pointer min-w-0 ${
                        lang === 'zh'
                          ? 'border-zinc-400 dark:border-zinc-500 bg-zinc-100/70 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium shadow-xs'
                          : 'border-zinc-200 dark:border-zinc-700/80 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      <Globe size={18} className={lang === 'zh' ? 'text-zinc-800 dark:text-zinc-200 shrink-0' : 'text-zinc-400 shrink-0'} />
                      <div className="min-w-0">
                        <div className="font-medium text-xs truncate">简体中文</div>
                        <div className="text-[10px] text-zinc-400 truncate">中文界面</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setLangState('en')
                        setLang('en')
                      }}
                      className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition cursor-pointer min-w-0 ${
                        lang === 'en'
                          ? 'border-zinc-400 dark:border-zinc-500 bg-zinc-100/70 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium shadow-xs'
                          : 'border-zinc-200 dark:border-zinc-700/80 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      <Globe size={18} className={lang === 'en' ? 'text-zinc-800 dark:text-zinc-200 shrink-0' : 'text-zinc-400 shrink-0'} />
                      <div className="min-w-0">
                        <div className="font-medium text-xs truncate">English</div>
                        <div className="text-[10px] text-zinc-400 truncate">English interface</div>
                      </div>
                    </button>
                  </div>
                </div>

                {/* 3. Markdown 自动排版 */}
                <div className="pt-2.5 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-medium text-xs text-zinc-800 dark:text-zinc-200">Markdown 自动排版</div>
                    <p className="text-zinc-500 text-[11px] leading-relaxed mt-0.5">
                      输入 1.、#、-、&gt;、**粗体**、$公式$ 时自动转换为列表、标题、引用、粗体与数学公式。
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={markdownAutoFormat}
                    onClick={() => {
                      const next = !markdownAutoFormat
                      setMarkdownAutoFormat(next)
                      try { localStorage.setItem('lightnote.markdownAutoFormat', String(next)) } catch { /* 忽略存储失败 */ }
                    }}
                    className={`relative shrink-0 w-10 h-6 rounded-full transition cursor-pointer ${markdownAutoFormat ? 'bg-[#009467]' : 'bg-zinc-300 dark:bg-zinc-600'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${markdownAutoFormat ? 'translate-x-4' : ''}`} />
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2: Data & Backup (数据与备份) */}
            {activeTab === 'data' && (
              <div className="space-y-3.5 pr-8 sm:pr-9">
                <div>
                  <h4 className="text-sm sm:text-base font-semibold text-zinc-900 dark:text-zinc-100">
                    数据与备份
                  </h4>
                  <p className="text-zinc-500 text-[11px] mt-0.5">
                    导出或还原笔记本与笔记数据，管理本地存储。
                  </p>
                </div>

                <div className="space-y-1.5 pt-1">
                  <div className="font-medium text-xs text-zinc-800 dark:text-zinc-200">本地数据备份</div>
                  <p className="text-zinc-500 text-[11px] leading-relaxed">
                    导出为单个标准 JSON 格式，可随时还原或导入 Windows 桌面版。
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={handleExport}
                      disabled={isExporting}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 transition cursor-pointer text-xs"
                    >
                      <Download size={14} />
                      <span>导出全部笔记 (JSON)</span>
                    </button>

                    <label className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 transition cursor-pointer text-xs">
                      <Upload size={14} />
                      <span>导入备份文件</span>
                      <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                    </label>
                  </div>
                </div>

                <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2">
                  <div className="font-medium text-xs text-zinc-800 dark:text-zinc-200">存储清理</div>
                  <button
                    onClick={handleEmptyTrash}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 rounded-lg transition cursor-pointer text-xs"
                  >
                    <Trash2 size={14} />
                    <span>清空回收站</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Mobile Version at bottom */}
          <div className="sm:hidden border-t border-zinc-200 dark:border-zinc-800 py-2.5 text-center text-[11px] text-zinc-400 select-none">
            {APP_DISPLAY_VERSION}
          </div>
        </div>
      </div>
    </div>
  )
}

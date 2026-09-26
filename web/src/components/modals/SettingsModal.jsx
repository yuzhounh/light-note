import React, { useState } from 'react'
import { X, Download, Upload, Trash2, Sun, Moon, Database } from 'lucide-react'
import { db } from '../../core/db/database'
import { APP_DISPLAY_VERSION } from '../../core/version'

export function SettingsModal({
  isOpen,
  onClose,
  theme,
  onChangeTheme,
  onDataImported
}) {
  const [activeTab, setActiveTab] = useState('appearance') // 'appearance' | 'data'
  const [isExporting, setIsExporting] = useState(false)
  const [msg, setMsg] = useState('')

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
      await db.notes.filter(n => !!n.is_deleted).delete()
      setMsg('回收站已清空。')
      if (onDataImported) onDataImported()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs select-none">
      <div 
        className="w-full max-w-xl h-[420px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-row animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Left Column: Navigation Tabs & Version at bottom */}
        <div className="w-44 bg-zinc-50 dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 flex flex-col justify-between shrink-0">
          <div className="p-3">
            <h3 className="px-2 pt-1 pb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              设置
            </h3>
            <div className="space-y-1">
              <button
                onClick={() => { setActiveTab('appearance'); setMsg('') }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition cursor-pointer text-left ${
                  activeTab === 'appearance'
                    ? 'bg-amber-100/70 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 font-semibold'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-900'
                }`}
              >
                <Sun size={15} />
                <span>外观主题</span>
              </button>

              <button
                onClick={() => { setActiveTab('data'); setMsg('') }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition cursor-pointer text-left ${
                  activeTab === 'data'
                    ? 'bg-amber-100/70 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 font-semibold'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-900'
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
        <div className="flex-1 flex flex-col bg-white dark:bg-zinc-900 min-w-0 overflow-hidden">
          {/* Header with Close X button */}
          <div className="flex items-center justify-end px-4 pt-3.5 pb-1">
            <button
              onClick={onClose}
              className="p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
              title="关闭"
            >
              <X size={16} />
            </button>
          </div>

          {/* Scrollable Tab Body */}
          <div className="flex-1 overflow-y-auto px-6 pb-6 pt-1 text-xs text-zinc-700 dark:text-zinc-300 space-y-4">
            {msg && (
              <div className="p-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-md text-amber-800 dark:text-amber-300">
                {msg}
              </div>
            )}

            {/* TAB 1: Appearance (外观主题) */}
            {activeTab === 'appearance' && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                    外观主题
                  </h4>
                  <p className="text-zinc-500 text-[11px] mt-0.5">
                    选择浅色明亮或深色护眼外观。
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <button
                    onClick={() => onChangeTheme('light')}
                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition cursor-pointer ${
                      theme === 'light'
                        ? 'border-amber-500 bg-amber-50/40 dark:bg-amber-950/20 text-zinc-900 dark:text-zinc-100 shadow-xs'
                        : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <Sun size={18} className="text-amber-500 shrink-0" />
                    <div>
                      <div className="font-medium text-xs">浅色模式</div>
                      <div className="text-[10px] text-zinc-400">标准明亮界面</div>
                    </div>
                  </button>

                  <button
                    onClick={() => onChangeTheme('dark')}
                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition cursor-pointer ${
                      theme === 'dark'
                        ? 'border-amber-500 bg-amber-50/40 dark:bg-amber-950/20 text-zinc-900 dark:text-zinc-100 shadow-xs'
                        : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <Moon size={18} className="text-amber-500 shrink-0" />
                    <div>
                      <div className="font-medium text-xs">深色模式</div>
                      <div className="text-[10px] text-zinc-400">暗色护眼界面</div>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2: Data & Backup (数据与备份) */}
            {activeTab === 'data' && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
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
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 transition cursor-pointer"
                    >
                      <Download size={14} />
                      <span>导出全部笔记 (JSON)</span>
                    </button>

                    <label className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 transition cursor-pointer">
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
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 rounded-lg transition cursor-pointer"
                  >
                    <Trash2 size={14} />
                    <span>清空回收站</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

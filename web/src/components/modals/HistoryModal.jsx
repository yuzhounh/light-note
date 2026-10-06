import React, { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { NotesRepository } from '../../core/db/notesRepository'

function formatTime(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 历史版本：左侧版本列表，右侧预览，可把所选版本恢复为当前内容。 */
export function HistoryModal({ note, onClose, onRestore }) {
  const [versions, setVersions] = useState(null)
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    let cancelled = false
    NotesRepository.getNoteVersions(note.id).then(list => {
      if (cancelled) return
      setVersions(list)
      setSelectedId(list[0]?.id ?? null)
    })
    return () => { cancelled = true }
  }, [note.id])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const selected = versions?.find(v => v.id === selectedId)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-xs p-3" onClick={onClose}>
      <div
        className="w-full max-w-4xl h-[min(80vh,640px)] flex flex-col bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="历史版本"
      >
        <div className="flex items-center justify-between px-5 h-12 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">历史版本</h3>
          <button
            onClick={onClose}
            title="关闭（Esc）"
            className="w-7 h-7 rounded-full flex items-center justify-center text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {versions === null ? (
          <div className="flex-1 flex items-center justify-center text-xs text-zinc-400">加载中…</div>
        ) : versions.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-xs text-zinc-400 px-6 text-center">
            这篇笔记还没有历史版本。连续编辑期间不会产生细碎版本，停顿 10 分钟以上再编辑时，会保存编辑前的内容。
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col sm:flex-row">
            <div className="sm:w-60 max-h-40 sm:max-h-none shrink-0 overflow-y-auto border-b sm:border-b-0 sm:border-r border-zinc-200 dark:border-zinc-800 p-2 space-y-1">
              {versions.map(version => (
                <button
                  key={version.id}
                  onClick={() => setSelectedId(version.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs transition cursor-pointer ${
                    version.id === selectedId
                      ? 'bg-[#d3f0e3] dark:bg-[#234a3f] text-[#007f55] dark:text-emerald-400 font-medium'
                      : 'text-zinc-700 dark:text-zinc-300 hover:bg-[#e4e7eb] dark:hover:bg-[#363b43]'
                  }`}
                >
                  <div>{formatTime(version.created_at)}</div>
                  <div className="truncate opacity-70 mt-0.5">{version.title || '无标题笔记'}</div>
                </button>
              ))}
            </div>

            <div className="flex-1 min-w-0 overflow-y-auto p-5">
              {selected && (
                <>
                  <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
                    {selected.title || '无标题笔记'}
                  </h4>
                  <div
                    className="text-sm leading-6 text-zinc-800 dark:text-zinc-200 break-words [&_img]:max-w-full [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_p]:my-2"
                    dangerouslySetInnerHTML={{ __html: selected.body_html || '' }}
                  />
                </>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 px-5 h-14 border-t border-zinc-200 dark:border-zinc-800 shrink-0">
          <button
            onClick={onClose}
            className="px-4 h-9 rounded-lg text-sm border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-[#e4e7eb] dark:hover:bg-[#363b43] transition cursor-pointer"
          >
            取消
          </button>
          <button
            disabled={!selected}
            onClick={() => onRestore(selected)}
            className="px-4 h-9 rounded-lg text-sm bg-[#009467] hover:bg-[#007f55] disabled:opacity-40 disabled:cursor-not-allowed text-white transition cursor-pointer"
          >
            恢复所选版本
          </button>
        </div>
      </div>
    </div>
  )
}

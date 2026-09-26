import React from 'react'
import { ArrowLeft, Check, Clock, Pin, Trash2, Folder } from 'lucide-react'
import { LightEditor } from '../../editor/LightEditor'

export function NoteDetail({
  note,
  notebookName,
  onUpdateTitle,
  onUpdateContent,
  onTogglePin,
  onDeleteNote,
  saveStatus, // 'saved' | 'saving'
  onBackMobile,
  isMobile
}) {
  if (!note) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-400 select-none bg-zinc-50/50 dark:bg-zinc-950/50">
        <p className="text-sm">选择一篇笔记或新建笔记开始记录</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full w-full bg-white dark:bg-zinc-900 overflow-hidden">
      {/* Detail Top Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/70 backdrop-blur select-none">
        <div className="flex items-center gap-2">
          {isMobile && (
            <button
              onClick={onBackMobile}
              className="p-1.5 -ml-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
              title="返回笔记列表"
            >
              <ArrowLeft size={18} />
            </button>
          )}

          {/* Notebook Badge */}
          <div className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
            <Folder size={12} />
            <span>{notebookName || '默认笔记本'}</span>
          </div>

          {/* Save Status Indicator */}
          <div className="flex items-center gap-1 text-[11px] text-zinc-400">
            {saveStatus === 'saving' ? (
              <span className="flex items-center gap-1 text-amber-500 animate-pulse">
                <Clock size={12} />
                <span>保存中...</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <Check size={12} />
                <span>已存入本地</span>
              </span>
            )}
          </div>
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => onTogglePin(note.id)}
            className={`p-1.5 rounded-lg transition ${
              note.is_pinned === 1
                ? 'text-amber-500 bg-amber-50 dark:bg-amber-950/30'
                : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
            title={note.is_pinned === 1 ? '取消置顶' : '置顶笔记'}
          >
            <Pin size={16} className={note.is_pinned === 1 ? 'fill-current' : ''} />
          </button>

          <button
            onClick={() => {
              if (confirm('确定移入回收站？')) {
                onDeleteNote(note.id)
              }
            }}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-rose-500 transition"
            title="删除笔记"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Note Title Input */}
      <div className="px-6 pt-5 pb-2 bg-white dark:bg-zinc-900">
        <input
          type="text"
          placeholder="无标题"
          value={note.title || ''}
          onChange={e => onUpdateTitle(e.target.value)}
          className="w-full text-xl sm:text-2xl font-bold bg-transparent outline-none text-zinc-900 dark:text-zinc-100 placeholder-zinc-300 dark:placeholder-zinc-600"
        />
      </div>

      {/* Editor Main Content */}
      <div className="flex-1 overflow-hidden">
        <LightEditor
          content={note.body_html || ''}
          onChange={onUpdateContent}
          isMobile={isMobile}
        />
      </div>
    </div>
  )
}

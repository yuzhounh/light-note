import React from 'react'
import { ArrowLeft } from 'lucide-react'
import { LightEditor } from '../../editor/LightEditor'

export function NoteDetail({
  note,
  onUpdateTitle,
  onUpdateContent,
  onBackMobile,
  isMobile
}) {
  if (!note) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-400 select-none bg-white dark:bg-zinc-900">
        <p className="text-xs">选择或新建笔记开始记录</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full w-full bg-white dark:bg-zinc-900 overflow-hidden">
      {/* Mobile-only Back Header */}
      {isMobile && (
        <div className="flex items-center px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <button
            onClick={onBackMobile}
            className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300 p-1 rounded"
          >
            <ArrowLeft size={16} />
            <span>返回列表</span>
          </button>
        </div>
      )}

      {/* Editor with top toolbar */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Note Title Input placed inside the scrollable view before body */}
        <div className="px-10 pt-6 pb-2 bg-white dark:bg-zinc-900">
          <input
            type="text"
            placeholder="无标题"
            value={note.title || ''}
            onChange={e => onUpdateTitle(e.target.value)}
            className="w-full text-2xl font-bold bg-transparent outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-300 dark:placeholder:text-zinc-700"
          />
        </div>

        <div className="flex-1 overflow-hidden">
          <LightEditor
            content={note.body_html || ''}
            onChange={onUpdateContent}
            isMobile={isMobile}
          />
        </div>
      </div>
    </div>
  )
}

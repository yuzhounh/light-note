import React, { useRef } from 'react'
import { ArrowLeft } from 'lucide-react'
import { LightEditor } from '../../editor/LightEditor'

export function NoteDetail({
  note,
  onUpdateTitle,
  onUpdateContent,
  onBackMobile,
  isMobile
}) {
  const editorRef = useRef(null)

  if (!note) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-400 select-none bg-white dark:bg-zinc-900">
        <p className="text-xs">选择或新建笔记开始记录</p>
      </div>
    )
  }

  function handleTitleKeyDown(e) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      editorRef.current?.focus('end')
    }
  }

  return (
    <div className="flex flex-col h-full w-full bg-white dark:bg-zinc-900 overflow-hidden">
      {/* Mobile-only Back Header */}
      {isMobile && (
        <div className="flex items-center px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shrink-0">
          <button
            onClick={onBackMobile}
            className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300 p-1 rounded cursor-pointer"
          >
            <ArrowLeft size={16} />
            <span>返回列表</span>
          </button>
        </div>
      )}

      {/* Editor component with toolbar at top, title below toolbar, and content */}
      <div className="flex-1 overflow-hidden">
        <LightEditor
          ref={editorRef}
          title={note.title || ''}
          onUpdateTitle={onUpdateTitle}
          content={note.body_html || ''}
          onChange={onUpdateContent}
          isMobile={isMobile}
        />
      </div>
    </div>
  )
}

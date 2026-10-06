import React, { useRef } from 'react'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { LightEditor } from '../../editor/LightEditor'

export function NoteDetail({
  note,
  onUpdateTitle,
  onUpdateContent,
  onBackMobile,
  onSoftDelete,
  isMobile,
  autoFocus = false,
  onFocused,
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
      editorRef.current?.focus('start')
    }
  }

  return (
    <div className="flex flex-col h-full w-full bg-white dark:bg-zinc-900 overflow-hidden">
      {/* Mobile-only Back Header */}
      {isMobile && (
        <div className="flex items-center justify-between px-3 h-12 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shrink-0">
          <button
            onClick={onBackMobile}
            className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300 px-2 py-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <ArrowLeft size={16} />
            <span>返回列表</span>
          </button>

          <div className="flex items-center gap-1">
            {onSoftDelete && (
              <button
                onClick={() => {
                  if (confirm('确定将该笔记移入回收站？')) {
                    onSoftDelete(note.id)
                  }
                }}
                className="p-1.5 text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                title="移入回收站"
              >
                <Trash2 size={17} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Editor component with toolbar at top, title below toolbar, and content */}
      <div className="flex-1 overflow-hidden">
        <LightEditor
          key={note.id}
          ref={editorRef}
          title={note.title || ''}
          onUpdateTitle={onUpdateTitle}
          content={note.body_html || ''}
          onChange={onUpdateContent}
          isMobile={isMobile}
          autoFocus={autoFocus}
          onFocused={onFocused}
        />
      </div>
    </div>
  )
}

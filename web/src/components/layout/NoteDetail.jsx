import React, { lazy, Suspense, useRef } from 'react'
import { ArrowLeft, Trash2, History } from 'lucide-react'
import { countWords, formatInfoTime } from '../../core/noteInfo'
const LightEditor = lazy(() => import('../../editor/LightEditor').then(module => ({ default: module.LightEditor })))

export function NoteDetail({
  note,
  onUpdateTitle,
  onUpdateContent,
  onBackMobile,
  onSoftDelete,
  onOpenHistory,
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
    <div className={`flex flex-col h-full w-full overflow-hidden ${isMobile ? 'bg-surface' : 'bg-white dark:bg-zinc-900'}`}>
      {/* 手机顶栏：返回 + 历史版本 + 移入回收站（48dp 图标按钮，蓝色强调） */}
      {isMobile && (
        <div className="flex items-center justify-between pl-1 pr-1 h-[60px] border-b border-line bg-surface shrink-0">
          <button
            onClick={onBackMobile}
            aria-label="返回列表"
            title="返回列表"
            className="phone-pressable w-12 h-12 p-3 rounded-full flex items-center justify-center text-ink cursor-pointer"
          >
            <ArrowLeft size={24} strokeWidth={1.8} />
          </button>

          <div className="flex items-center">
            {onOpenHistory && (
              <button
                onClick={() => onOpenHistory(note)}
                className="phone-pressable w-12 h-12 p-3 rounded-full flex items-center justify-center text-ink cursor-pointer"
                aria-label="历史版本"
                title="历史版本"
              >
                <History size={24} strokeWidth={1.8} />
              </button>
            )}
            {onSoftDelete && (
              <button
                onClick={() => {
                  if (confirm('确定将该笔记移入回收站？')) {
                    onSoftDelete(note.id)
                  }
                }}
                className="phone-pressable w-12 h-12 p-3 rounded-full flex items-center justify-center text-ink cursor-pointer"
                aria-label="移入回收站"
                title="移入回收站"
              >
                <Trash2 size={24} strokeWidth={1.8} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Editor component with toolbar at top, title below toolbar, and content */}
      <div className="flex-1 overflow-hidden">
        <Suspense fallback={<div className="p-4 text-sm text-zinc-500" role="status">正在加载编辑器…</div>}>
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
        </Suspense>
      </div>

      {/* 桌面端底部信息栏：字数、创建与编辑时间，以及历史版本入口 */}
      {!isMobile && (
        <div className="h-8 shrink-0 flex items-center justify-between gap-4 px-4 border-t border-zinc-100 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400 select-none">
          <div className="flex items-center gap-4 min-w-0 truncate">
            <span>字数统计：{countWords(note.body_text)}</span>
            <span>创建于 {formatInfoTime(note.created_at || note.updated_at)}</span>
            <span>编辑于 {formatInfoTime(note.updated_at)}</span>
          </div>
          {onOpenHistory && (
            <button
              onClick={() => onOpenHistory(note)}
              className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-[#e4e7eb] dark:hover:bg-[#363b43] transition cursor-pointer"
              title="查看或恢复历史版本"
            >
              <History size={13} />
              <span>历史版本</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

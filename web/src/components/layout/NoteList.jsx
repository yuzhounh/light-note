import React, { useState, useEffect, useRef } from 'react'
import { Menu, Trash2, FileText, X, ArrowUpDown, Check, Search, History } from 'lucide-react'
import { countWords, formatInfoTime } from '../../core/noteInfo'

function getNotePreviewText(bodyText) {
  if (!bodyText) return '无附加正文...'
  const match = /^\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s*/.exec(bodyText)
  if (match) {
    const after = bodyText.slice(match[0].length).trim()
    if (after) {
      return after
    }
  }
  return bodyText.trim() || '无附加正文...'
}

// 卡片密度：紧凑 / 舒适 / 宽松（与桌面端三档对应）
const DENSITY_STYLES = {
  compact: { card: 'p-2.5', titleGap: 'mb-0.5', summary: 'leading-snug', footer: 'mt-1' },
  comfortable: { card: 'p-3.5', titleGap: 'mb-1.5', summary: 'leading-relaxed', footer: 'mt-2.5' },
  spacious: { card: 'p-5', titleGap: 'mb-2', summary: 'leading-7', footer: 'mt-3.5' },
}

function OptionRow({ checked, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
    >
      <span className="w-3.5 shrink-0">{checked && <Check size={13} />}</span>
      <span>{children}</span>
    </button>
  )
}

export function NoteList({
  notes,
  activeNoteId,
  onSelectNote,
  searchQuery,
  onSearchChange,
  currentNotebookName,
  notebooks = [],
  currentNotebookId = null,
  onOpenSidebar,
  onSoftDelete,
  onOpenHistory,
  sort = { by: 'created', descending: true },
  onSortChange,
  density = 'comfortable',
  onDensityChange,
  isMobile,
  isTablet = false
}) {
  const [isOptionsOpen, setIsOptionsOpen] = useState(false)
  const optionsRef = useRef(null)
  const cardStyle = DENSITY_STYLES[density] || DENSITY_STYLES.comfortable

  useEffect(() => {
    if (!isOptionsOpen) return undefined
    const handlePointerDown = e => {
      if (optionsRef.current && !optionsRef.current.contains(e.target)) setIsOptionsOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isOptionsOpen])

  const [visibleCount, setVisibleCount] = useState(25)
  const [activeActionNote, setActiveActionNote] = useState(null)
  const longPressTimerRef = useRef(null)
  const touchStartPosRef = useRef({ x: 0, y: 0 })
  const isLongPressActiveRef = useRef(false)

  const isTouchDevice = isMobile || isTablet

  const startLongPress = (note, clientX, clientY) => {
    if (!isTouchDevice) return
    touchStartPosRef.current = { x: clientX, y: clientY }
    isLongPressActiveRef.current = false

    longPressTimerRef.current = setTimeout(() => {
      isLongPressActiveRef.current = true
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate(40)
        } catch (_) {}
      }
      setActiveActionNote(note)
    }, 450)
  }

  const handleTouchStart = (e, note) => {
    const touch = e.touches[0]
    startLongPress(note, touch.clientX, touch.clientY)
  }

  const handleTouchMove = (e) => {
    if (!longPressTimerRef.current) return
    const touch = e.touches[0]
    const dx = Math.abs(touch.clientX - touchStartPosRef.current.x)
    const dy = Math.abs(touch.clientY - touchStartPosRef.current.y)
    if (dx > 10 || dy > 10) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const handleMouseDown = (e, note) => {
    if (e.button !== 0) return
    if (!isTouchDevice) return
    startLongPress(note, e.clientX, e.clientY)
  }

  const handleMouseMove = (e) => {
    if (!longPressTimerRef.current) return
    const dx = Math.abs(e.clientX - touchStartPosRef.current.x)
    const dy = Math.abs(e.clientY - touchStartPosRef.current.y)
    if (dx > 10 || dy > 10) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const handleMouseUp = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const handleNoteCardClick = (noteId) => {
    if (isLongPressActiveRef.current) {
      isLongPressActiveRef.current = false
      return
    }
    onSelectNote(noteId)
  }

  // Check if all displayed notes belong to the same notebook
  const isSingleNotebook = Boolean(currentNotebookId) || (
    notes.length > 0 && notes.every(n => (n.notebook_id || null) === (notes[0].notebook_id || null))
  )

  function getNotebookName(notebookId) {
    if (!notebookId) return '未归类'
    const found = notebooks.find(nb => nb.id === notebookId)
    return found ? found.name : '未归类'
  }

  // Reset pagination when filter or notes change
  useEffect(() => {
    setVisibleCount(25)
  }, [notes.length, searchQuery, currentNotebookName])

  function handleScroll(e) {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    if (scrollTop + clientHeight >= scrollHeight - 120) {
      if (visibleCount < notes.length) {
        setVisibleCount(prev => Math.min(prev + 20, notes.length))
      }
    }
  }

  function formatFullDate(isoString) {
    if (!isoString) return ''
    const d = new Date(isoString)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const mins = String(d.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day} ${hours}:${mins}`
  }

  function highlightMatch(text, query) {
    if (!query || !query.trim() || !text) return text
    const q = query.trim()
    const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    const parts = text.split(regex)
    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="bg-[#ffe066]/45 dark:bg-[#ffe066]/25 text-inherit rounded-sm font-[inherit]">
          {part}
        </mark>
      ) : (
        part
      )
    )
  }

  const visibleNotes = notes.slice(0, visibleCount)

  return (
    <div className="note-list flex flex-col h-full w-full bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 select-none">
      {/* Mobile Top Navbar with Right Hamburger */}
      {isMobile ? (
        <div className="flex items-center justify-between px-4 h-14 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shrink-0">
          <div className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="LightNote" className="w-7 h-7 rounded-lg shadow-xs shrink-0" />
            <span className="font-bold text-base text-zinc-900 dark:text-zinc-100 tracking-tight">LightNote</span>
            {searchQuery && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 font-medium">
                搜索中
              </span>
            )}
          </div>

          <button
            onClick={onOpenSidebar}
            aria-label="打开导航与设置"
            title="打开导航与设置"
            className="w-10 h-10 min-w-10 min-h-10 rounded-full border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 flex items-center justify-center text-zinc-700 dark:text-zinc-200 hover:border-emerald-500 hover:text-emerald-500 transition cursor-pointer shadow-xs shrink-0"
          >
            <Menu size={20} />
          </button>
        </div>
      ) : (
        /* Desktop Search Input */
        <div className="p-3 pb-1.5 shrink-0">
          <div className="relative flex items-center">
            <input
              type="text"
              placeholder="搜索标题和正文"
              value={searchQuery}
              onChange={e => onSearchChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  onSearchChange('')
                  e.currentTarget.blur()
                }
              }}
              className="w-full h-[38px] pl-4 pr-11 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-transparent text-[15px] text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 outline-none transition"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="清除搜索"
                title="清除搜索（Esc）"
                className="absolute right-1 w-[30px] h-[30px] rounded-full flex items-center justify-center text-zinc-700 dark:text-zinc-200 hover:bg-[#e4e7eb] dark:hover:bg-[#363b43] transition cursor-pointer"
              >
                <X size={15} />
              </button>
            ) : (
              <Search size={16} className="absolute right-4 text-zinc-700 dark:text-zinc-300 pointer-events-none" />
            )}
          </div>
        </div>
      )}

      {/* Category & Status Subheader */}
      <div className="px-4 py-2 border-b border-zinc-100 dark:border-zinc-800/60 text-xs text-zinc-700 dark:text-zinc-300 font-medium flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate">
            {searchQuery ? `搜索: "${searchQuery}"` : (currentNotebookName || '全部笔记')}
          </span>
          <span className="text-zinc-400 shrink-0">({notes.length}条)</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onSortChange && (
            <div className="relative" ref={optionsRef}>
              <button
                onClick={() => setIsOptionsOpen(open => !open)}
                title="排序与卡片密度"
                aria-label="排序与卡片密度"
                className="p-1 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
              >
                <ArrowUpDown size={14} />
              </button>
              {isOptionsOpen && (
                <div className="absolute right-0 top-full mt-1 w-40 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg z-30">
                  <div className="px-3 py-1 text-[11px] font-semibold text-zinc-400">排序依据</div>
                  <OptionRow checked={sort.by === 'created'} onClick={() => onSortChange({ ...sort, by: 'created' })}>创建时间</OptionRow>
                  <OptionRow checked={sort.by === 'updated'} onClick={() => onSortChange({ ...sort, by: 'updated' })}>修改时间</OptionRow>
                  <OptionRow checked={sort.descending} onClick={() => onSortChange({ ...sort, descending: !sort.descending })}>逆序</OptionRow>
                  <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
                  <div className="px-3 py-1 text-[11px] font-semibold text-zinc-400">卡片密度</div>
                  <OptionRow checked={density === 'compact'} onClick={() => onDensityChange?.('compact')}>紧凑</OptionRow>
                  <OptionRow checked={density === 'comfortable'} onClick={() => onDensityChange?.('comfortable')}>舒适</OptionRow>
                  <OptionRow checked={density === 'spacious'} onClick={() => onDensityChange?.('spacious')}>宽松</OptionRow>
                </div>
              )}
            </div>
          )}
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
            >
              清除搜索
            </button>
          )}
          {notes.length > visibleNotes.length && (
            <span className="text-[11px] text-zinc-400 font-normal">
              已载入 {visibleNotes.length}
            </span>
          )}
        </div>
      </div>

      {/* Note Cards List (Progressive Loading on Scroll) */}
      <div 
        onScroll={handleScroll}
        className="note-list-scroll flex-1 min-h-0 overflow-y-auto px-2 py-1 space-y-1"
      >
        {notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-zinc-400 text-sm text-center p-6 space-y-2 select-none">
            <FileText size={32} className="opacity-30 mb-1" />
            <p className="font-medium text-zinc-600 dark:text-zinc-300">暂无相关笔记</p>
            <p className="text-xs text-zinc-400">点击左上角“新建笔记”或登录账号同步云端笔记</p>
          </div>
        ) : (
          <>
            {visibleNotes.map(note => {
              const isSelected = note.id === activeNoteId

              return (
                <div
                  key={note.id}
                  onClick={() => handleNoteCardClick(note.id)}
                  onTouchStart={(e) => handleTouchStart(e, note)}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  onTouchCancel={handleTouchEnd}
                  onMouseDown={(e) => handleMouseDown(e, note)}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onContextMenu={(e) => {
                    if (isTouchDevice) {
                      e.preventDefault()
                      setActiveActionNote(note)
                    }
                  }}
                  className={`group relative ${cardStyle.card} rounded-md cursor-pointer transition select-none ${
                    isSelected
                      ? 'bg-[#d3f0e3] dark:bg-[#234a3f] ring-1 ring-inset ring-[#a8e4cd] dark:ring-[#2a6552] text-zinc-900 dark:text-zinc-100'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/60 text-zinc-800 dark:text-zinc-200'
                  }`}
                >
                  <div className="flex flex-col">
                    {/* Top part: Lines 1-3 (Title + Preview) */}
                    <div className="min-w-0">
                      <div className={`${cardStyle.titleGap} flex items-center gap-1.5`}>
                        <h4 className="text-[14.5px] font-semibold truncate text-zinc-900 dark:text-zinc-100">
                          {highlightMatch(note.title || '无标题', searchQuery)}
                        </h4>
                      </div>

                      <p className={`text-[13px] text-zinc-600 dark:text-zinc-400 line-clamp-2 ${cardStyle.summary}`}>
                        {highlightMatch(getNotePreviewText(note.body_text), searchQuery)}
                      </p>
                    </div>

                    {/* Bottom part: Line 4 (Date on left, Notebook name with expanded width) */}
                    <div className={`note-card-footer flex items-center justify-between text-xs text-zinc-400 font-sans ${cardStyle.footer}`}>
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="shrink-0">{formatFullDate(sort.by === 'updated' ? note.updated_at : (note.created_at || note.updated_at))}</span>

                        {!isSingleNotebook && (
                          <span
                            className={`truncate text-[11px] px-1.5 py-0.5 rounded max-w-[200px] transition ${
                              isSelected
                                ? 'bg-emerald-100/80 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                            }`}
                            title={getNotebookName(note.notebook_id)}
                          >
                            {getNotebookName(note.notebook_id)}
                          </span>
                        )}
                      </div>

                      {/* Quick action on hover (Desktop only, never on mobile or tablet) */}
                      {!isMobile && !isTablet && (
                        <div className="note-actions hidden lg:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0 ml-2">
                          {onSoftDelete && (
                            <button
                              onClick={(e) => { 
                                e.stopPropagation()
                                if (confirm('确定移入回收站？')) onSoftDelete(note.id)
                              }}
                              className="p-0.5 hover:text-rose-500 rounded transition text-zinc-400"
                              title="移入回收站"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}

            {visibleCount < notes.length && (
              <div className="py-2 text-center text-xs text-zinc-400">
                向下滚动加载更多...
              </div>
            )}
          </>
        )}
      </div>

      {/* Mobile Long-Press Bottom Action Sheet */}
      {activeActionNote && (
        <div 
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-xs animate-in fade-in duration-200"
          onClick={() => setActiveActionNote(null)}
        >
          <div 
            className="w-full max-w-sm mx-auto bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl p-4 shadow-2xl space-y-3 pb-[calc(1rem+var(--safe-bottom,0px))] sm:pb-4 animate-in slide-in-from-bottom duration-200"
            onClick={e => e.stopPropagation()}
          >
            {/* Action Sheet Header */}
            <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <div className="min-w-0 flex-1 pr-2">
                <p className="text-[11px] text-zinc-400 font-medium">笔记快捷操作</p>
                <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate mt-0.5">
                  {activeActionNote.title || '无标题笔记'}
                </h4>
              </div>
              <button
                onClick={() => setActiveActionNote(null)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 cursor-pointer"
                title="关闭"
              >
                <X size={15} />
              </button>
            </div>

            {/* 笔记详情：字数、创建与编辑时间 */}
            <div className="text-xs text-zinc-500 dark:text-zinc-400 leading-5">
              <div>字数统计：{countWords(activeActionNote.body_text)}</div>
              <div>创建于 {formatInfoTime(activeActionNote.created_at || activeActionNote.updated_at)}</div>
              <div>编辑于 {formatInfoTime(activeActionNote.updated_at)}</div>
            </div>

            {/* Action Menu Options */}
            <div className="space-y-1 pt-0.5">
              {onOpenHistory && (
                <button
                  onClick={() => {
                    const target = activeActionNote
                    setActiveActionNote(null)
                    onOpenHistory(target)
                  }}
                  className="w-full h-11 flex items-center gap-3 px-3 rounded-xl text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                >
                  <div className="w-7 h-7 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 shrink-0">
                    <History size={15} />
                  </div>
                  <span className="flex-1 text-left">历史版本</span>
                </button>
              )}
              {onSoftDelete && (
                <button
                  onClick={() => {
                    const id = activeActionNote.id
                    setActiveActionNote(null)
                    if (confirm('确定将该笔记移入回收站？')) {
                      onSoftDelete(id)
                    }
                  }}
                  className="w-full h-11 flex items-center gap-3 px-3 rounded-xl text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 active:bg-rose-100 dark:active:bg-rose-950/60 transition cursor-pointer"
                >
                  <div className="w-7 h-7 rounded-lg bg-rose-50 dark:bg-rose-950/50 flex items-center justify-center text-rose-500 shrink-0">
                    <Trash2 size={15} />
                  </div>
                  <span className="flex-1 text-left">移入回收站</span>
                </button>
              )}
            </div>

            {/* Cancel Button */}
            <button
              onClick={() => setActiveActionNote(null)}
              className="w-full h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium text-xs hover:bg-zinc-200 dark:hover:bg-zinc-700 active:bg-zinc-300 dark:active:bg-zinc-600 transition cursor-pointer"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

import React, { useState, useEffect, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { Menu, FileText, X, ArrowUpDown, Check, Search, Plus } from 'lucide-react'
import { NoteContextMenu } from './NoteContextMenu'
import { useBackDismiss } from '../../hooks/useBackDismiss'

const isAndroidApp = Capacitor.getPlatform() === 'android'

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

function SyncLabel({ state }) {
  const text = state?.status === 'syncing' ? '正在同步'
    : state?.status === 'synced' ? '已同步'
    : state?.status === 'error' ? '同步异常' : null
  if (state?.status === 'error') return <button type="button" role="status" aria-live="polite"
    onClick={() => window.alert(`同步异常\n${state.error || '请检查网络后下拉重试'}`)}
    className="text-[11px] font-normal whitespace-nowrap text-rose-500 cursor-pointer">{text}</button>
  return text ? <span role="status" aria-live="polite" aria-label={state.status === 'error' ? `同步异常：${state.error || '请下拉重试'}` : text}
    className={`text-[11px] font-normal whitespace-nowrap ${state.status === 'error' ? 'text-rose-500' : 'text-zinc-400 dark:text-zinc-500'}`}>{text}</span> : null
}

export function NoteList({
  notes,
  activeNoteId,
  onSelectNote,
  onCreateNote,
  searchQuery,
  onSearchChange,
  currentNotebookName,
  notebooks = [],
  currentNotebookId = null,
  onOpenSidebar,
  onSoftDelete,
  onOpenHistory,
  syncStatus,
  onSync,
  sort = { by: 'created', descending: true },
  onSortChange,
  density = 'comfortable',
  onDensityChange,
  isMobile,
  isTablet = false,
  isViewActive = true
}) {
  const [isOptionsOpen, setIsOptionsOpen] = useState(false)
  const optionsRef = useRef(null)
  const scrollRef = useRef(null)
  const pullRef = useRef(null)
  const pullSyncingRef = useRef(false)
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
  const [actionAnchor, setActionAnchor] = useState(null)
  const [pressedNoteId, setPressedNoteId] = useState(null)
  const longPressTimerRef = useRef(null)
  const touchStartPosRef = useRef({ x: 0, y: 0 })
  const isLongPressActiveRef = useRef(false)

  const isTouchDevice = isMobile || isTablet
  useBackDismiss(isViewActive && isOptionsOpen, () => setIsOptionsOpen(false), 30)
  useEffect(() => {
    if (!isViewActive) {
      clearTimeout(longPressTimerRef.current)
      setIsOptionsOpen(false)
      setActiveActionNote(null)
      setPressedNoteId(null)
    }
  }, [isViewActive])

  function openActionMenu(note, clientX, clientY, rect) {
    clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = null
    isLongPressActiveRef.current = true
    setActionAnchor({ point: { x: clientX, y: clientY }, rect: { top: rect.top, bottom: rect.bottom } })
    setActiveActionNote(note)
    setPressedNoteId(null)
  }

  function closeActionMenu() {
    isLongPressActiveRef.current = false
    setActiveActionNote(null)
  }

  const startLongPress = (note, clientX, clientY, rect) => {
    if (!isTouchDevice) return
    clearTimeout(longPressTimerRef.current)
    setPressedNoteId(note.id)
    touchStartPosRef.current = { x: clientX, y: clientY }
    isLongPressActiveRef.current = false

    longPressTimerRef.current = setTimeout(() => {
      isLongPressActiveRef.current = true
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate(40)
        } catch (_) {}
      }
      openActionMenu(note, clientX, clientY, rect)
    }, 450)
  }

  const handleTouchStart = (e, note) => {
    const touch = e.touches[0]
    startLongPress(note, touch.clientX, touch.clientY, e.currentTarget.getBoundingClientRect())
  }

  const handleTouchMove = (e) => {
    if (!longPressTimerRef.current) return
    const touch = e.touches[0]
    const dx = Math.abs(touch.clientX - touchStartPosRef.current.x)
    const dy = Math.abs(touch.clientY - touchStartPosRef.current.y)
    if (dx > 10 || dy > 10) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
      setPressedNoteId(null)
    }
  }

  const handleTouchEnd = () => {
    setPressedNoteId(null)
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const handleMouseDown = (e, note) => {
    if (e.button !== 0) return
    if (!isTouchDevice) return
    startLongPress(note, e.clientX, e.clientY, e.currentTarget.getBoundingClientRect())
  }

  const handleMouseMove = (e) => {
    if (!longPressTimerRef.current) return
    const dx = Math.abs(e.clientX - touchStartPosRef.current.x)
    const dy = Math.abs(e.clientY - touchStartPosRef.current.y)
    if (dx > 10 || dy > 10) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
      setPressedNoteId(null)
    }
  }

  const handleMouseUp = () => {
    setPressedNoteId(null)
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

  // Editing a note keeps the Android list mounted, including its rendered pages.
  useEffect(() => {
    setVisibleCount(25)
    if (isAndroidApp && scrollRef.current) scrollRef.current.scrollTop = 0
  }, [isAndroidApp ? null : notes.length, searchQuery, currentNotebookName,
    isAndroidApp ? currentNotebookId : null, isAndroidApp ? sort.by : null, isAndroidApp ? sort.descending : null])

  function handleScroll(e) {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    if (scrollTop + clientHeight >= scrollHeight - 120) {
      if (visibleCount < notes.length) {
        setVisibleCount(prev => Math.min(prev + 20, notes.length))
      }
    }
  }

  function startPull(e) {
    pullRef.current = null
    if (!isViewActive || !isTouchDevice || !onSync || pullSyncingRef.current || syncStatus?.status === 'syncing' ||
        e.touches.length !== 1 || (scrollRef.current?.scrollTop ?? 1) > 0 ||
        e.target.closest?.('button,input,textarea,[contenteditable="true"]')) return
    pullRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }

  function movePull(e) {
    const start = pullRef.current
    if (!start) return
    if (e.touches.length !== 1 || (scrollRef.current?.scrollTop ?? 1) > 0) { pullRef.current = null; return }
    const dx = Math.abs(e.touches[0].clientX - start.x)
    const dy = e.touches[0].clientY - start.y
    if (dy < -10 || (dx > 12 && dx > Math.abs(dy))) pullRef.current = null
    if (dy > 10) handleTouchEnd()
  }

  function finishPull(e) {
    const start = pullRef.current
    pullRef.current = null
    if (!start || !isViewActive || activeActionNote || pullSyncingRef.current ||
        syncStatus?.status === 'syncing' || (scrollRef.current?.scrollTop ?? 1) > 0 ||
        (e.changedTouches[0]?.clientY ?? start.y) - start.y < 64) return
    handleTouchEnd()
    pullSyncingRef.current = true
    Promise.resolve().then(() => onSync()).catch(error => console.warn('Pull sync failed:', error))
      .finally(() => { pullSyncingRef.current = false })
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

  useEffect(() => () => clearTimeout(longPressTimerRef.current), [])

  const visibleNotes = notes.slice(0, visibleCount)
  const isCompactHeader = isAndroidApp && isMobile
  const ScrollContainer = isCompactHeader ? 'div' : React.Fragment

  return (
    <div className="note-list flex flex-col h-full w-full bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 select-none">
      <ScrollContainer {...(isCompactHeader ? {
        className: 'note-list-native-scroll flex-1 min-h-0 overflow-y-auto overscroll-y-contain',
        onScroll: handleScroll,
        ref: scrollRef,
        onTouchStart: startPull,
        onTouchMove: movePull,
        onTouchEnd: finishPull,
        onTouchCancel: () => { pullRef.current = null },
      } : {})}>
      {isCompactHeader && (
        <div className="note-list-brand flex items-center justify-between px-4 h-13 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <img src="/favicon.svg" alt="LightNote" className="w-7 h-7 rounded-lg shadow-xs shrink-0" />
            <span className="font-bold text-base text-zinc-900 dark:text-zinc-100 tracking-tight">LightNote</span>
            <SyncLabel state={syncStatus} />
          </div>
          <button
            onClick={onOpenSidebar}
            aria-label="打开导航与设置"
            title="打开导航与设置"
            className="w-11 h-11 min-w-11 min-h-11 rounded-full border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 flex items-center justify-center text-zinc-700 dark:text-zinc-200 hover:border-emerald-500 hover:text-emerald-500 transition cursor-pointer shadow-xs shrink-0"
          >
            <Menu size={20} />
          </button>
        </div>
      )}
      {/* Mobile Top Navbar with Right Hamburger */}
      {isMobile && !isCompactHeader && (
        <div className="flex items-center justify-between px-4 h-14 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shrink-0">
          <div className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="LightNote" className="w-7 h-7 rounded-lg shadow-xs shrink-0" />
            <span className="font-bold text-base text-zinc-900 dark:text-zinc-100 tracking-tight">LightNote</span>
            <SyncLabel state={syncStatus} />
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
      )}
      {!isMobile && (
        /* Desktop Search Input */
        <div className="p-3 pb-1.5 shrink-0 flex items-center gap-2">
          <div className="relative flex flex-1 min-w-0 items-center">
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
              className="w-full min-w-0 h-[38px] pl-4 pr-11 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-transparent text-[15px] text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 outline-none transition"
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
          {onCreateNote && (
            <button
              type="button"
              onClick={onCreateNote}
              title="新建笔记（Ctrl+N）"
              aria-label="新建笔记"
              className="w-[38px] h-[38px] shrink-0 rounded-full flex items-center justify-center bg-zinc-100 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 hover:bg-[#dfe3e8] dark:hover:bg-[#363b43] active:bg-[#d8dce0] dark:active:bg-[#3e444d] transition cursor-pointer"
            >
              <Plus size={20} strokeWidth={1.8} />
            </button>
          )}
        </div>
      )}

      {/* Category & Status Subheader */}
      <div className={`note-list-toolbar ${isCompactHeader ? 'sticky top-0 z-20 px-3 h-12 gap-2 bg-white dark:bg-zinc-950' : 'px-4 py-2'} border-b border-zinc-100 dark:border-zinc-800/60 text-xs text-zinc-700 dark:text-zinc-300 font-medium flex items-center justify-between shrink-0`}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate">
            {searchQuery ? (isCompactHeader ? '搜索结果' : `搜索: "${searchQuery}"`) : (currentNotebookName || '全部笔记')}
          </span>
          <span className="text-zinc-400 shrink-0">{isCompactHeader ? `· ${notes.length}` : `(${notes.length}条)`}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onSortChange && (
            <div className="relative" ref={optionsRef}>
              <button
                onClick={() => setIsOptionsOpen(open => !open)}
                title="排序与卡片密度"
                aria-label="排序与卡片密度"
                className={`${isCompactHeader ? 'w-11 h-11 rounded-full' : 'p-1 rounded'} flex items-center justify-center text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer`}
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
          {isMobile && onCreateNote && (
            <button
              type="button"
              onClick={onCreateNote}
              title="新建笔记"
              aria-label="新建笔记"
              className={`${isCompactHeader ? 'w-11 h-11 rounded-full' : 'p-1 rounded'} flex items-center justify-center text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:opacity-80 transition cursor-pointer`}
            >
              <Plus size={15} strokeWidth={1.6} />
            </button>
          )}
          {searchQuery && !isCompactHeader && (
            <button
              onClick={() => onSearchChange('')}
              className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
            >
              清除搜索
            </button>
          )}
          {!isCompactHeader && notes.length > visibleNotes.length && (
            <span className="text-[11px] text-zinc-400 font-normal">
              已载入 {visibleNotes.length}
            </span>
          )}
        </div>
      </div>

      {/* Note Cards List (Progressive Loading on Scroll) */}
      <div 
        ref={isCompactHeader ? undefined : scrollRef}
        onScroll={isCompactHeader ? undefined : handleScroll}
        onTouchStart={isCompactHeader ? undefined : startPull}
        onTouchMove={isCompactHeader ? undefined : movePull}
        onTouchEnd={isCompactHeader ? undefined : finishPull}
        onTouchCancel={isCompactHeader ? undefined : () => { pullRef.current = null }}
        className={`note-list-scroll ${isCompactHeader ? '' : 'flex-1 min-h-0 overflow-y-auto overscroll-y-contain'} px-2 py-1 space-y-0.5`}
      >
        {notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-zinc-400 text-sm text-center p-6 space-y-2 select-none">
            <FileText size={32} className="opacity-30 mb-1" />
            <p className="font-medium text-zinc-600 dark:text-zinc-300">暂无相关笔记</p>
            <p className="text-xs text-zinc-400">可通过右下角新建笔记或登录读取云端笔记</p>
          </div>
        ) : (
          <>
            {visibleNotes.map((note, index) => {
              const isSelected = note.id === activeNoteId
              const nextIsSelected = visibleNotes[index + 1]?.id === activeNoteId

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
                    e.preventDefault()
                    openActionMenu(note, e.clientX, e.clientY, e.currentTarget.getBoundingClientRect())
                  }}
                  className={`note-card group relative ${pressedNoteId === note.id || activeActionNote?.id === note.id ? 'note-card-pressed' : ''} ${cardStyle.card} rounded-md cursor-pointer transition select-none ${
                    isSelected
                      ? 'my-0.5 bg-[#d3f0e3] dark:bg-[#234a3f] ring-1 ring-inset ring-[#a8e4cd] dark:ring-[#2a6552] text-zinc-900 dark:text-zinc-100'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/60 text-zinc-800 dark:text-zinc-200'
                  }`}
                >
                  <div className="flex flex-col">
                    {/* Top part: Lines 1-3 (Title + Preview) */}
                    <div className="min-w-0">
                      <div className={`${cardStyle.titleGap} flex items-center gap-1.5`}>
                        <h4 className={`${isAndroidApp ? 'text-[13.5px]' : 'text-[14.5px]'} font-semibold truncate text-zinc-900 dark:text-zinc-100`}>
                          {highlightMatch(note.title || '无标题', searchQuery)}
                        </h4>
                      </div>

                      <p className={`${isAndroidApp ? 'text-[12px]' : 'text-[13px]'} text-zinc-600 dark:text-zinc-400 line-clamp-2 ${cardStyle.summary}`}>
                        {highlightMatch(getNotePreviewText(note.body_text), searchQuery)}
                      </p>
                    </div>

                    {/* Date and notebook use opposite ends in every column layout. */}
                    <div className={`note-card-footer flex items-center justify-between ${isAndroidApp ? 'text-[11px]' : 'text-xs'} text-zinc-400 font-sans ${cardStyle.footer}`}>
                      <div className="flex items-center justify-between gap-2 min-w-0 flex-1">
                        <span className="shrink-0">{formatFullDate(sort.by === 'updated' ? note.updated_at : (note.created_at || note.updated_at))}</span>

                        {!isSingleNotebook && (
                          <span
                            className={`min-w-0 truncate ${isAndroidApp ? 'text-[10px]' : 'text-[11px]'} px-1.5 py-0.5 rounded max-w-[200px] transition ${
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

                    </div>
                  </div>

                  {/* 笔记之间的分割线 */}
                  {!isSelected && !nextIsSelected && index < visibleNotes.length - 1 && (
                    <div className="absolute bottom-0 left-3 right-3 h-[1px] bg-zinc-200/90 dark:bg-zinc-500/75 pointer-events-none" />
                  )}
                </div>
              )
            })}


            {visibleCount < notes.length && (
              <div className="py-2 text-center text-xs text-zinc-400">
                {isCompactHeader ? `已显示 ${visibleNotes.length} / ${notes.length}，向下滚动查看更多` : '向下滚动加载更多...'}
              </div>
            )}
          </>
        )}
      </div>
      </ScrollContainer>

      {/* One anchored menu for Android, browser long press and desktop right click. */}
      {isViewActive && activeActionNote && actionAnchor && (
        <NoteContextMenu note={activeActionNote} anchor={actionAnchor} scrollElement={scrollRef.current}
          onClose={closeActionMenu} onOpenHistory={onOpenHistory}
          onSoftDelete={isMobile ? undefined : onSoftDelete} />
      )}
    </div>
  )
}

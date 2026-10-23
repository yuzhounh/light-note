import React, { useState, useEffect, useRef } from 'react'
import {
  Menu, Check, Search, X, Plus, FileText, EllipsisVertical, FolderInput, Trash2, Undo2, History, Info,
} from 'lucide-react'
import { countWords, formatInfoTime } from '../../core/noteInfo'
import { useBackDismiss } from '../../hooks/useBackDismiss'
import { CompactMenu, PhoneDialog, PhoneIconButton, useToast, ICON_STROKE } from './phoneUi'

// 手机主界面：视图标题栏 + 常驻搜索框 + 列表面板 + 浮动新建按钮；长按进入选择模式

const DENSITY = {
  compact: { pad: 'py-2', lines: 'line-clamp-1', gap: 'mt-1' },
  comfortable: { pad: 'py-3', lines: 'line-clamp-2', gap: 'mt-1.5' },
  spacious: { pad: 'py-4', lines: 'line-clamp-3', gap: 'mt-2' },
}

function previewText(bodyText) {
  if (!bodyText) return '无附加正文...'
  const match = /^\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s*/.exec(bodyText)
  if (match) {
    const after = bodyText.slice(match[0].length).trim()
    if (after) return after
  }
  return bodyText.trim() || '无附加正文...'
}

function formatDate(isoString) {
  if (!isoString) return ''
  const d = new Date(isoString)
  const pad = value => String(value).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function Highlight({ text, query }) {
  if (!query || !query.trim() || !text) return text
  const regex = new RegExp(`(${query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  return text.split(regex).map((part, i) =>
    i % 2 === 1
      ? <mark key={i} className="bg-[#ffe066]/45 dark:bg-[#ffe066]/25 text-inherit rounded-sm">{part}</mark>
      : part)
}

function StatusLine({ selecting, selectedCount, syncStatus }) {
  if (selecting) return <div className="text-[11px] text-muted leading-[14px]">已选择 {selectedCount} 项</div>
  const status = syncStatus?.status
  if (status === 'error') {
    return (
      <button type="button" role="status" onClick={() => window.alert(`同步异常\n${syncStatus.error || '请检查网络后下拉重试'}`)}
        className="block !min-h-0 !min-w-0 text-[11px] leading-[14px] text-rose-500 cursor-pointer">同步异常</button>
    )
  }
  const text = status === 'syncing' ? '正在同步' : status === 'synced' ? '已同步' : null
  return text ? <div role="status" aria-live="polite" className="text-[11px] text-muted leading-[14px]">{text}</div> : null
}

export function PhoneNoteList({
  notes,
  notebooks = [],
  currentNotebookId = null,
  currentNotebookName,
  currentView = 'all',
  searchQuery,
  onSearchChange,
  onSelectNote,
  onCreateNote,
  onOpenMenu,
  syncStatus,
  onSync,
  sort = { by: 'created', descending: true },
  density = 'comfortable',
  isViewActive = true,
  onOpenHistory,
  onMoveNotes,
  onTrashNotes,
  onRestoreNotes,
  onPurgeNotes,
  onEmptyTrash,
}) {
  const isTrash = currentView === 'trash'
  const style = DENSITY[density] || DENSITY.comfortable
  const [collapsed, setCollapsed] = useState(false)
  const [visibleCount, setVisibleCount] = useState(25)
  const [selected, setSelected] = useState(() => new Set())
  const [selecting, setSelecting] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [dialog, setDialog] = useState(null) // 'move' | 'trash' | 'purge' | 'empty' | 'info'
  const [toast, showToast] = useToast()
  const scrollRef = useRef(null)
  const lastTopRef = useRef(0)
  const pullRef = useRef(null)
  const pullSyncingRef = useRef(false)
  const pressTimerRef = useRef(null)
  const pressStartRef = useRef({ x: 0, y: 0 })
  const longPressedRef = useRef(false)

  const selectedNotes = notes.filter(note => selected.has(note.id))
  const allSelected = notes.length > 0 && selectedNotes.length === notes.length

  function exitSelection() {
    setSelecting(false)
    setSelected(new Set())
    setMoreOpen(false)
    setDialog(null)
  }

  useBackDismiss(isViewActive && selecting, exitSelection, 40)

  useEffect(() => {
    if (!isViewActive) {
      clearTimeout(pressTimerRef.current)
      exitSelection()
    }
  }, [isViewActive])

  // 列表刷新后丢弃已不存在的选中项
  useEffect(() => {
    if (!selecting) return
    setSelected(prev => {
      const ids = new Set(notes.map(note => note.id))
      const next = new Set([...prev].filter(id => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [notes])

  useEffect(() => {
    setVisibleCount(25)
    setCollapsed(false)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [searchQuery, currentNotebookId, currentView, sort.by, sort.descending])

  useEffect(() => () => clearTimeout(pressTimerRef.current), [])

  function toggle(id) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
    setSelecting(next.size > 0)
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(notes.map(note => note.id)))
    setSelecting(!allSelected)
  }

  function startPress(note, x, y) {
    if (selecting) return
    clearTimeout(pressTimerRef.current)
    pressStartRef.current = { x, y }
    longPressedRef.current = false
    pressTimerRef.current = setTimeout(() => {
      longPressedRef.current = true
      pressTimerRef.current = null
      try { navigator.vibrate?.(40) } catch { /* 无振动能力 */ }
      toggle(note.id)
    }, 450)
  }

  function movePress(x, y) {
    if (!pressTimerRef.current) return
    if (Math.abs(x - pressStartRef.current.x) > 10 || Math.abs(y - pressStartRef.current.y) > 10) {
      clearTimeout(pressTimerRef.current)
      pressTimerRef.current = null
    }
  }

  function endPress() {
    clearTimeout(pressTimerRef.current)
    pressTimerRef.current = null
  }

  function handleCardClick(note) {
    if (longPressedRef.current) { longPressedRef.current = false; return }
    if (selecting) toggle(note.id)
    else onSelectNote(note.id)
  }

  function handleScroll(event) {
    const el = event.currentTarget
    const top = el.scrollTop
    if (top + el.clientHeight >= el.scrollHeight - 160 && visibleCount < notes.length) {
      setVisibleCount(count => Math.min(count + 20, notes.length))
    }
    const delta = top - lastTopRef.current
    if (top <= 0) setCollapsed(false)
    else if (Math.abs(delta) > 8) {
      if (delta > 0 && top > 48 && el.scrollHeight > el.clientHeight + 160) setCollapsed(true)
      else if (delta < 0) setCollapsed(false)
    }
    if (Math.abs(delta) > 8) lastTopRef.current = top
  }

  // 下拉刷新：仅在列表顶部且非选择模式时触发同步
  function startPull(event) {
    pullRef.current = null
    if (!isViewActive || selecting || !onSync || pullSyncingRef.current || syncStatus?.status === 'syncing' ||
        event.touches.length !== 1 || (scrollRef.current?.scrollTop ?? 1) > 0 ||
        event.target.closest?.('button,input,textarea')) return
    pullRef.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }
  }

  function movePull(event) {
    const start = pullRef.current
    if (!start) return
    if (event.touches.length !== 1 || (scrollRef.current?.scrollTop ?? 1) > 0) { pullRef.current = null; return }
    const dx = Math.abs(event.touches[0].clientX - start.x)
    const dy = event.touches[0].clientY - start.y
    if (dy < -10 || (dx > 12 && dx > Math.abs(dy))) pullRef.current = null
    if (dy > 10) endPress()
  }

  function finishPull(event) {
    const start = pullRef.current
    pullRef.current = null
    if (!start || !isViewActive || selecting || pullSyncingRef.current || syncStatus?.status === 'syncing' ||
        (scrollRef.current?.scrollTop ?? 1) > 0 ||
        (event.changedTouches[0]?.clientY ?? start.y) - start.y < 64) return
    endPress()
    pullSyncingRef.current = true
    Promise.resolve().then(() => onSync()).catch(error => console.warn('Pull sync failed:', error))
      .finally(() => { pullSyncingRef.current = false })
  }

  const ids = selectedNotes.map(note => note.id)
  const count = ids.length
  const single = count === 1 ? selectedNotes[0] : null

  async function run(action, message) {
    const done = ids.length
    exitSelection()
    await action(ids)
    showToast(`${message} ${done} 篇笔记`)
  }

  const notebookName = id => notebooks.find(nb => nb.id === id)?.name || '未归类'
  const title = searchQuery ? '搜索结果' : isTrash ? '回收站' : (currentNotebookName || '全部笔记')
  const visibleNotes = notes.slice(0, visibleCount)
  const isSingleNotebook = Boolean(currentNotebookId) || (
    notes.length > 0 && notes.every(note => (note.notebook_id || null) === (notes[0].notebook_id || null)))

  const actions = isTrash
    ? [
      { label: '恢复', icon: Undo2, disabled: !count, onClick: () => run(onRestoreNotes, '已恢复') },
      { label: '彻底删除', icon: Trash2, disabled: !count, onClick: () => setDialog('purge') },
    ]
    : [
      { label: '移动', icon: FolderInput, disabled: !count, onClick: () => setDialog('move') },
      { label: '删除', icon: Trash2, disabled: !count, onClick: () => setDialog('trash') },
    ]

  const moreItems = isTrash
    ? [{ label: '清空回收站', icon: <Trash2 size={20} strokeWidth={ICON_STROKE} />, danger: true, onClick: () => setDialog('empty') }]
    : [
      { label: '历史版本', icon: <History size={20} strokeWidth={ICON_STROKE} />, hidden: !single || !onOpenHistory,
        onClick: () => { const note = single; exitSelection(); onOpenHistory(note) } },
      { label: '笔记信息', icon: <Info size={20} strokeWidth={ICON_STROKE} />, hidden: !single, onClick: () => setDialog('info') },
    ]
  const hasMore = moreItems.some(item => !item.hidden)

  return (
    <div className="phone-list relative flex flex-col h-full w-full select-none">
      <div
        className="phone-header shrink-0 flex items-center pl-4 pr-1"
        style={{ height: collapsed ? 48 : 60 }}
      >
        <div className="flex-1 min-w-0">
          <h1
            className="font-bold truncate text-ink leading-6"
            style={{ fontSize: collapsed ? 16 : 18 }}
          >
            {title}
            {!selecting && <span className="font-normal text-muted"> · {notes.length}</span>}
          </h1>
          <div className="overflow-hidden" style={{ maxHeight: collapsed ? 0 : 16, opacity: collapsed ? 0 : 1, transition: 'max-height 180ms ease, opacity 180ms ease' }}>
            <StatusLine selecting={selecting} selectedCount={count} syncStatus={syncStatus} />
          </div>
        </div>
        {selecting ? (
          <PhoneIconButton label={allSelected ? '取消全选' : '全选'} onClick={toggleAll} active={allSelected}>
            <Check size={24} strokeWidth={ICON_STROKE} />
          </PhoneIconButton>
        ) : (
          <PhoneIconButton label="菜单" onClick={onOpenMenu}>
            <Menu size={24} strokeWidth={ICON_STROKE} />
          </PhoneIconButton>
        )}
      </div>

      <div className="phone-search shrink-0 px-4 overflow-hidden" style={{ maxHeight: collapsed ? 0 : 54, opacity: collapsed ? 0 : 1, paddingBottom: collapsed ? 0 : 8 }}>
        <div className="relative flex items-center h-[46px]">
          <Search size={20} strokeWidth={ICON_STROKE} className="absolute left-4 text-muted pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={event => onSearchChange(event.target.value)}
            placeholder="搜索标题和正文"
            className="w-full h-[46px] pl-11 pr-11 rounded-3xl bg-surface/80 border border-line text-ink placeholder:text-muted outline-none focus:border-brand transition"
          />
          {searchQuery && (
            <button type="button" aria-label="清除搜索" onClick={() => onSearchChange('')}
              className="absolute right-1 w-10 h-10 rounded-full flex items-center justify-center text-muted cursor-pointer">
              <X size={18} strokeWidth={ICON_STROKE} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          onTouchStart={startPull}
          onTouchMove={movePull}
          onTouchEnd={finishPull}
          onTouchCancel={() => { pullRef.current = null }}
          className="note-list-scroll h-full overflow-y-auto overscroll-y-contain px-3"
          style={{ paddingBottom: 'calc(96px + var(--safe-bottom))' }}
        >
          {notes.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-center px-8 gap-2 text-muted">
              <FileText size={32} strokeWidth={ICON_STROKE} className="opacity-50" />
              <p className="text-[14px]">
                {searchQuery ? '没有找到匹配的笔记' : isTrash ? '回收站是空的' : '还没有笔记，点右下角的 + 新建'}
              </p>
            </div>
          ) : (
            <>
              {visibleNotes.map((note, index) => {
                const isChecked = selected.has(note.id)
                return (
                  <div
                    key={note.id}
                    onClick={() => handleCardClick(note)}
                    onTouchStart={event => startPress(note, event.touches[0].clientX, event.touches[0].clientY)}
                    onTouchMove={event => movePress(event.touches[0].clientX, event.touches[0].clientY)}
                    onTouchEnd={endPress}
                    onTouchCancel={endPress}
                    onMouseDown={event => event.button === 0 && startPress(note, event.clientX, event.clientY)}
                    onMouseMove={event => movePress(event.clientX, event.clientY)}
                    onMouseUp={endPress}
                    onMouseLeave={endPress}
                    onContextMenu={event => { event.preventDefault(); if (!selecting) toggle(note.id) }}
                    className={`phone-pressable relative flex gap-3 px-2 ${style.pad} rounded-2xl cursor-pointer select-none ${isChecked ? 'bg-tint' : ''}`}
                  >
                    {selecting && (
                      <span
                        aria-label={isChecked ? '已选择' : '未选择'}
                        className={`w-7 h-7 shrink-0 self-center rounded-full flex items-center justify-center border-[1.5px] ${
                          isChecked ? 'bg-brand border-brand text-white' : 'border-line text-transparent'}`}
                      >
                        <Check size={16} strokeWidth={2.4} />
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <h4 className="text-[15px] font-semibold text-ink truncate">
                        <Highlight text={note.title || '无标题'} query={searchQuery} />
                      </h4>
                      <p className={`text-[14px] text-muted leading-snug ${style.lines}`}>
                        <Highlight text={previewText(note.body_text)} query={searchQuery} />
                      </p>
                      <div className={`${style.gap} flex items-center justify-between gap-2 text-[12px] text-muted`}>
                        <span className="shrink-0">{formatDate(sort.by === 'updated' ? note.updated_at : (note.created_at || note.updated_at))}</span>
                        {!isSingleNotebook && (
                          <span className="min-w-0 max-w-[50%] truncate text-[11px] px-1.5 py-0.5 rounded-md bg-tint text-brand">
                            {notebookName(note.notebook_id)}
                          </span>
                        )}
                      </div>
                    </div>
                    {!isChecked && index < visibleNotes.length - 1 && (
                      <div className="absolute bottom-0 left-2 right-2 h-px bg-line pointer-events-none" />
                    )}
                  </div>
                )
              })}
              {visibleCount < notes.length && <div className="h-6" />}
            </>
          )}
        </div>
      </div>

      {!selecting && !isTrash && (
        <button
          type="button"
          onClick={onCreateNote}
          aria-label="新建笔记"
          title="新建笔记"
          className="mobile-new-note fixed w-14 h-14 rounded-full bg-brand text-white shadow-lg flex items-center justify-center active:scale-95 transition z-40 cursor-pointer"
          style={{ right: 'calc(20px + var(--safe-right))', bottom: 'calc(20px + var(--safe-bottom))' }}
        >
          <Plus size={26} strokeWidth={2} />
        </button>
      )}

      {selecting && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 bg-surface border-t border-line rounded-t-3xl flex items-stretch justify-around px-2 pt-1"
          style={{ paddingBottom: 'calc(4px + var(--safe-bottom))' }}
        >
          {actions.map(action => (
            <button key={action.label} type="button" disabled={action.disabled} onClick={action.onClick}
              className={`phone-pressable flex-1 h-14 rounded-2xl flex flex-col items-center justify-center gap-0.5 cursor-pointer ${action.disabled ? 'text-muted opacity-50' : 'text-ink'}`}>
              <action.icon size={22} strokeWidth={ICON_STROKE} />
              <span className="text-[11px]">{action.label}</span>
            </button>
          ))}
          <button type="button" onClick={exitSelection}
            className="phone-pressable flex-1 h-14 rounded-2xl flex flex-col items-center justify-center gap-0.5 text-ink cursor-pointer">
            <X size={22} strokeWidth={ICON_STROKE} />
            <span className="text-[11px]">取消</span>
          </button>
          {hasMore && (
            <button type="button" aria-label="更多" onClick={() => setMoreOpen(true)}
              className="phone-pressable flex-1 h-14 rounded-2xl flex flex-col items-center justify-center gap-0.5 text-ink cursor-pointer">
              <EllipsisVertical size={22} strokeWidth={ICON_STROKE} />
              <span className="text-[11px]">更多</span>
            </button>
          )}
        </div>
      )}

      {moreOpen && (
        <CompactMenu items={moreItems} onClose={() => setMoreOpen(false)}
          style={{ right: 'calc(12px + var(--safe-right))', bottom: 'calc(76px + var(--safe-bottom))' }} />
      )}

      {dialog === 'move' && (
        <PhoneDialog title={`移动 ${count} 篇笔记到`} onClose={() => setDialog(null)}>
          {notebooks.length === 0 && <div className="px-4 py-3 text-muted">还没有笔记本，请先在菜单中新建。</div>}
          {notebooks.map(nb => (
            <button key={nb.id} type="button" onClick={() => run(selectedIds => onMoveNotes(selectedIds, nb.id), '已移动')}
              className="phone-pressable w-full min-h-12 px-4 rounded-2xl flex items-center gap-3 text-left cursor-pointer">
              <FolderInput size={20} strokeWidth={ICON_STROKE} className="text-muted shrink-0" />
              <span className="flex-1 truncate">{nb.name}</span>
            </button>
          ))}
        </PhoneDialog>
      )}

      {dialog === 'trash' && (
        <PhoneDialog title="移入回收站" onClose={() => setDialog(null)}
          actions={[{ label: '取消', onClick: () => setDialog(null) },
            { label: '移入回收站', danger: true, onClick: () => run(onTrashNotes, '已移入回收站') }]}>
          <div className="px-4 pb-2 text-muted">将所选 {count} 篇笔记移入回收站，之后可在回收站恢复。</div>
        </PhoneDialog>
      )}

      {dialog === 'purge' && (
        <PhoneDialog title="彻底删除" onClose={() => setDialog(null)}
          actions={[{ label: '取消', onClick: () => setDialog(null) },
            { label: '彻底删除', danger: true, onClick: () => run(onPurgeNotes, '已彻底删除') }]}>
          <div className="px-4 pb-2 text-muted">将彻底删除所选 {count} 篇笔记，此操作无法撤销。</div>
        </PhoneDialog>
      )}

      {dialog === 'empty' && (
        <PhoneDialog title="清空回收站" onClose={() => setDialog(null)}
          actions={[{ label: '取消', onClick: () => setDialog(null) },
            { label: '清空', danger: true, onClick: async () => { exitSelection(); await onEmptyTrash(); showToast('回收站已清空') } }]}>
          <div className="px-4 pb-2 text-muted">将彻底删除回收站中的全部笔记，此操作无法撤销。</div>
        </PhoneDialog>
      )}

      {dialog === 'info' && single && (
        <PhoneDialog title="笔记信息" onClose={() => setDialog(null)} actions={[{ label: '好', primary: true, onClick: () => setDialog(null) }]}>
          <div className="px-4 pb-2 space-y-1 text-muted">
            <div>字数统计：{countWords(single.body_text)}</div>
            <div>创建于 {formatInfoTime(single.created_at || single.updated_at)}</div>
            <div>编辑于 {formatInfoTime(single.updated_at)}</div>
          </div>
        </PhoneDialog>
      )}

      {toast}
    </div>
  )
}

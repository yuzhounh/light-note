import React, { useState } from 'react'
import {
  X, Layers, Trash2, NotebookText, Settings, Plus, Check, ArrowUpDown, Rows3, Sun, Moon, Type, Download, Upload,
  LogIn, LogOut, Pencil, ChevronUp, ChevronDown, BookOpen, UserRound,
} from 'lucide-react'
import { APP_NAME, APP_VERSION } from '../../core/version'
import { exportBackup, importBackup } from '../../core/db/backup'
import { useBackDismiss } from '../../hooks/useBackDismiss'
import { CompactMenu, PhoneDialog, PhoneIconButton, useToast, ICON_STROKE } from './phoneUi'

// 全屏菜单：汇总视图 + 笔记本分组（齿轮管理）+ 少量全局设置 + 页脚

const DENSITY_LABEL = { compact: '紧凑', comfortable: '舒适', spacious: '宽松' }

function readMarkdownAutoFormat() {
  try { return localStorage.getItem('lightnote.markdownAutoFormat') !== 'false' } catch { return true }
}

function Icon({ as: Component, className = '' }) {
  return <Component size={22} strokeWidth={ICON_STROKE} className={`shrink-0 ${className}`} />
}

// 行：最小高度 48dp，图标 22dp，选中行浅主色底
function Row({ icon, label, sub, value, count, selected, onClick, trailing, danger }) {
  return (
    <div className={`flex items-center rounded-2xl ${selected ? 'bg-tint' : ''}`}>
      <button
        type="button"
        onClick={onClick}
        className={`phone-pressable flex-1 min-w-0 min-h-12 flex items-center gap-4 px-3 py-2 rounded-2xl text-left cursor-pointer ${
          selected ? 'text-brand' : danger ? 'text-rose-600 dark:text-rose-400' : 'text-ink'}`}
      >
        <Icon as={icon} className={selected ? 'text-brand' : danger ? '' : 'text-muted'} />
        <span className="flex-1 min-w-0">
          <span className="block text-[15px] truncate">{label}</span>
          {sub && <span className="block text-[12px] text-muted truncate">{sub}</span>}
        </span>
        {value && <span className="text-[12px] text-muted shrink-0 max-w-[40%] truncate">{value}</span>}
        {count > 0 && <span className="text-[12px] text-muted shrink-0">{count}</span>}
      </button>
      {trailing}
    </div>
  )
}

function Divider() {
  return <div className="h-px bg-line my-2" />
}

export function PhoneMenu({
  notebooks,
  notebookCounts,
  currentNotebookId,
  currentView,
  onSelectNotebook,
  onSelectView,
  onCreateNotebook,
  onRenameNotebook,
  onMoveNotebook,
  onDeleteNotebook,
  sort,
  onSortChange,
  density,
  onDensityChange,
  theme,
  onToggleTheme,
  currentUser,
  onLoginGoogle,
  onLogout,
  onDataImported,
  onClose,
}) {
  useBackDismiss(true, onClose, 50)
  const [toast, showToast] = useToast()
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [menu, setMenu] = useState(null) // { items, style }
  const [dialog, setDialog] = useState(null) // { type: 'rename' | 'delete', notebook }
  const [renameValue, setRenameValue] = useState('')
  const [markdownAuto, setMarkdownAuto] = useState(readMarkdownAutoFormat)

  const total = [...notebookCounts.values()].reduce((sum, value) => sum + value, 0)

  function openMenuAt(event, items) {
    const rect = event.currentTarget.getBoundingClientRect()
    const below = rect.bottom + 8
    const top = below + 260 > window.innerHeight ? Math.max(12, rect.top - 8 - items.filter(i => !i.hidden).length * 48 - 16) : below
    setMenu({ items, style: { top, right: 12 } })
  }

  function submitNewNotebook(event) {
    event.preventDefault()
    const name = newName.trim()
    if (!name) return
    onCreateNotebook(name)
    setNewName('')
    setAdding(false)
    onClose()
  }

  function notebookMenu(event, notebook, index) {
    openMenuAt(event, [
      { label: '重命名', icon: <Pencil size={20} strokeWidth={ICON_STROKE} />,
        onClick: () => { setRenameValue(notebook.name); setDialog({ type: 'rename', notebook }) } },
      { label: '上移', icon: <ChevronUp size={20} strokeWidth={ICON_STROKE} />, hidden: index === 0,
        onClick: () => onMoveNotebook(notebook.id, -1) },
      { label: '下移', icon: <ChevronDown size={20} strokeWidth={ICON_STROKE} />, hidden: index === notebooks.length - 1,
        onClick: () => onMoveNotebook(notebook.id, 1) },
      { label: '删除笔记本', icon: <Trash2 size={20} strokeWidth={ICON_STROKE} />, danger: true,
        onClick: () => setDialog({ type: 'delete', notebook }) },
    ])
  }

  function sortMenu(event) {
    openMenuAt(event, [
      { label: '按创建时间', checked: sort.by === 'created', onClick: () => onSortChange({ ...sort, by: 'created' }) },
      { label: '按修改时间', checked: sort.by === 'updated', onClick: () => onSortChange({ ...sort, by: 'updated' }) },
      { label: '逆序（新的在前）', checked: sort.descending, onClick: () => onSortChange({ ...sort, descending: !sort.descending }) },
    ])
  }

  function densityMenu(event) {
    openMenuAt(event, Object.entries(DENSITY_LABEL).map(([key, label]) => ({
      label, checked: density === key, onClick: () => onDensityChange(key),
    })))
  }

  async function handleExport() {
    try { await exportBackup(); showToast('已导出备份') } catch (err) { showToast('导出失败：' + err.message) }
  }

  async function handleImport(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const result = await importBackup(file)
      showToast(`已导入 ${result.notebooks} 个笔记本、${result.notes} 篇笔记`)
      onDataImported?.()
    } catch (err) {
      showToast('导入失败：' + err.message)
    }
  }

  function toggleMarkdownAuto() {
    const next = !markdownAuto
    setMarkdownAuto(next)
    try { localStorage.setItem('lightnote.markdownAutoFormat', String(next)) } catch { /* 忽略存储失败 */ }
  }

  const isDark = theme === 'dark'

  return (
    <div className="phone-menu fixed inset-0 z-50 phone-ui flex flex-col" role="dialog" aria-modal="true" aria-label="笔记本与设置"
      style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)', paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}>
      <div className="shrink-0 h-[60px] flex items-center pl-4 pr-1">
        <h1 className="flex-1 text-[18px] font-bold text-ink truncate">笔记本与设置</h1>
        <PhoneIconButton label="关闭" onClick={onClose}><X size={24} strokeWidth={ICON_STROKE} /></PhoneIconButton>
      </div>

      <div className="sidebar-navigation flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-6">
        <Row icon={Layers} label="全部笔记" count={total}
          selected={currentView === 'all' && !currentNotebookId}
          onClick={() => { onSelectView('all'); onClose() }} />
        <Row icon={Trash2} label="回收站" selected={currentView === 'trash'}
          onClick={() => { onSelectView('trash'); onClose() }} />

        <Divider />

        <div className="notebook-group">
          <div className="min-h-12 flex items-center gap-4 px-3">
            <Icon as={NotebookText} className="text-muted" />
            <span className="flex-1 text-[15px] font-bold text-ink">笔记本</span>
            <span className="text-[12px] text-muted">{notebooks.length}</span>
          </div>
          {notebooks.map((notebook, index) => (
            <Row key={notebook.id} icon={NotebookText} label={notebook.name}
              count={notebookCounts.get(notebook.id) || 0}
              selected={currentView === 'all' && currentNotebookId === notebook.id}
              onClick={() => { onSelectNotebook(notebook.id); onClose() }}
              trailing={(
                <PhoneIconButton label={`管理笔记本“${notebook.name}”`} className="text-muted"
                  onClick={event => notebookMenu(event, notebook, index)}>
                  <Settings size={22} strokeWidth={ICON_STROKE} />
                </PhoneIconButton>
              )} />
          ))}
          {adding ? (
            <form onSubmit={submitNewNotebook} className="flex items-center gap-2 px-3 min-h-12">
              <input
                autoFocus
                value={newName}
                onChange={event => setNewName(event.target.value)}
                placeholder="笔记本名称"
                maxLength={60}
                className="flex-1 min-w-0 h-10 px-3 rounded-[10px] bg-field text-ink placeholder:text-muted outline-none border border-transparent focus:border-brand"
              />
              <PhoneIconButton label="创建笔记本" className="text-brand" onClick={submitNewNotebook}>
                <Check size={24} strokeWidth={ICON_STROKE} />
              </PhoneIconButton>
              <PhoneIconButton label="取消" onClick={() => { setAdding(false); setNewName('') }}>
                <X size={24} strokeWidth={ICON_STROKE} />
              </PhoneIconButton>
            </form>
          ) : (
            <Row icon={Plus} label="新建笔记本" onClick={() => setAdding(true)} />
          )}
        </div>

        <Divider />

        <Row icon={ArrowUpDown} label="排序方式"
          value={`${sort.by === 'updated' ? '修改时间' : '创建时间'} · ${sort.descending ? '逆序' : '顺序'}`}
          onClick={sortMenu} />
        <Row icon={Rows3} label="卡片密度" value={DENSITY_LABEL[density] || '舒适'} onClick={densityMenu} />
        <Row icon={isDark ? Moon : Sun} label="外观" value={isDark ? '深色' : '浅色'} onClick={onToggleTheme} />
        <Row icon={Type} label="Markdown 自动排版"
          value={markdownAuto ? '开' : '关'}
          onClick={toggleMarkdownAuto} />

        <Divider />

        <Row icon={Download} label="导出备份" onClick={handleExport} />
        <label className="phone-pressable min-h-12 flex items-center gap-4 px-3 py-2 rounded-2xl cursor-pointer text-ink">
          <Icon as={Upload} className="text-muted" />
          <span className="flex-1 min-w-0 text-[15px]">导入备份</span>
          <input type="file" accept=".json" onChange={handleImport} className="hidden" />
        </label>

        <Row icon={BookOpen} label="使用文档" onClick={() => setDialog({ type: 'doc' })} />

        <Divider />

        {currentUser ? (
          <>
            <div className="min-h-12 flex items-center gap-3 pl-3 text-ink">
              <Icon as={UserRound} className="text-muted" />
              <span className="shrink-0 text-[15px] whitespace-nowrap">{currentUser.displayName || currentUser.email || '已登录'}</span>
              {currentUser.displayName && currentUser.email && (
                <span className="flex-1 min-w-0 text-[11px] text-muted truncate">{currentUser.email}</span>
              )}
              <div className="ml-auto shrink-0">
                <PhoneIconButton label="退出登录" onClick={() => { onLogout(); onClose() }}>
                  <LogOut size={20} strokeWidth={ICON_STROKE} />
                </PhoneIconButton>
              </div>
            </div>
          </>
        ) : (
          <Row icon={LogIn} label="登录 Google 账号" onClick={() => { onLoginGoogle(); onClose() }} />
        )}

        <div className="mt-4 pt-4 border-t border-line flex flex-col items-center">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="w-10 h-10 rounded-xl" />
          <div className="mt-2 text-[12px] text-muted">{APP_NAME} {APP_VERSION}</div>
        </div>
      </div>

      {menu && <CompactMenu items={menu.items} style={menu.style} onClose={() => setMenu(null)} />}

      {dialog?.type === 'doc' && (
        <PhoneDialog title="使用文档" onClose={() => setDialog(null)} actions={[{ label: '好', primary: true, onClick: () => setDialog(null) }]}>
          <div className="px-4 pb-2 space-y-3 text-muted">
            <div><div className="text-ink font-semibold">Markdown 自动排版</div>输入 # 、- 、**粗体** 等符号时自动转换为标题、列表和粗体。</div>
            <div><div className="text-ink font-semibold">导出备份</div>把全部笔记本与笔记导出为一个 JSON 文件。</div>
            <div><div className="text-ink font-semibold">导入备份</div>选择之前导出的 JSON 文件，恢复其中的笔记本与笔记。</div>
            <div><div className="text-ink font-semibold">登录 Google 账号</div>登录后可在多台设备间同步笔记。</div>
          </div>
        </PhoneDialog>
      )}

      {dialog?.type === 'rename' && (
        <PhoneDialog title="重命名笔记本" onClose={() => setDialog(null)}
          actions={[{ label: '取消', onClick: () => setDialog(null) },
            { label: '保存', primary: true, onClick: () => {
              const name = renameValue.trim()
              if (name && name !== dialog.notebook.name) onRenameNotebook(dialog.notebook.id, name)
              setDialog(null)
            } }]}>
          <div className="px-4 pb-2">
            <input autoFocus value={renameValue} onChange={event => setRenameValue(event.target.value)} maxLength={60}
              className="w-full h-11 px-3 rounded-[10px] bg-field text-ink outline-none border border-transparent focus:border-brand" />
          </div>
        </PhoneDialog>
      )}

      {dialog?.type === 'delete' && (
        <PhoneDialog title={`删除笔记本“${dialog.notebook.name}”`} onClose={() => setDialog(null)}
          actions={[{ label: '取消', onClick: () => setDialog(null) },
            { label: '删除', danger: true, onClick: () => { onDeleteNotebook(dialog.notebook.id); setDialog(null) } }]}>
          <div className="px-4 pb-2 text-muted">
            其中的 {notebookCounts.get(dialog.notebook.id) || 0} 篇笔记仍会保留，在“全部笔记”中显示为未归类。
          </div>
        </PhoneDialog>
      )}

      {toast}
    </div>
  )
}

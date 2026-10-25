import React, { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { useBackDismiss } from '../../hooks/useBackDismiss'

// 手机界面共用部件：图标按钮、紧凑菜单、对话框、Toast（尺寸取自 review/mobile_design_system.md）

export const ICON_STROKE = 1.8

// 48dp 图标按钮，内边距 12dp
export function PhoneIconButton({ label, onClick, children, className = '', active = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`phone-pressable w-12 h-12 min-w-12 min-h-12 shrink-0 rounded-full p-3 flex items-center justify-center cursor-pointer transition ${active ? 'text-brand' : 'text-ink'} ${className}`}
    >
      {children}
    </button>
  )
}

// 紧凑弹出菜单，宽度不超过 240dp；items: { label, icon, onClick, danger, checked, hidden }
export function CompactMenu({ items, onClose, style }) {
  useBackDismiss(true, onClose, 60)
  const visible = items.filter(item => !item.hidden)
  return (
    <div className="fixed inset-0 z-[70]" onClick={onClose}>
      <div
        role="menu"
        className="absolute w-60 max-w-[calc(100vw-32px)] rounded-3xl bg-surface border border-line shadow-xl py-2 overflow-hidden"
        style={style}
        onClick={event => event.stopPropagation()}
      >
        {visible.map(item => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            onClick={() => { onClose(); item.onClick() }}
            className={`phone-pressable w-full min-h-12 flex items-center gap-3 px-4 text-left text-[14px] cursor-pointer ${item.danger ? 'text-rose-600 dark:text-rose-400' : 'text-ink'}`}
          >
            <span className="w-[22px] h-[22px] flex items-center justify-center shrink-0 text-muted">
              {item.checked ? <Check size={20} strokeWidth={ICON_STROKE} className="text-brand" /> : item.icon}
            </span>
            <span className="flex-1 truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function PhoneScreen({ title, onClose, children }) {
  useBackDismiss(true, onClose, 60)
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[70] phone-ui flex min-h-0 w-full flex-col overflow-hidden"
      style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)', paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}
    >
      <div className="shrink-0 h-[60px] flex items-center pl-4 pr-1">
        <h1 className="flex-1 text-[18px] font-bold text-ink truncate">{title}</h1>
        <PhoneIconButton label={`关闭${title}`} onClick={onClose}>
          <X size={24} strokeWidth={ICON_STROKE} />
        </PhoneIconButton>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-5 text-[14px] text-ink">{children}</div>
    </div>
  )
}

// 对话框：白底、圆角 24dp；actions: { label, onClick, primary, danger }
export function PhoneDialog({ title, onClose, children, actions = [] }) {
  useBackDismiss(true, onClose, 60)
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-black/35" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm max-h-[80dvh] flex flex-col rounded-3xl bg-surface shadow-2xl overflow-hidden"
        onClick={event => event.stopPropagation()}
      >
        {title && <div className="px-6 pt-5 pb-2 text-[16px] font-bold text-ink">{title}</div>}
        <div className="px-2 pb-2 overflow-y-auto text-[14px] text-ink">{children}</div>
        {actions.length > 0 && (
          <div className="flex justify-end gap-2 px-4 pb-4 pt-2">
            {actions.map(action => (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                className={`h-11 px-5 rounded-[18px] text-[13px] font-semibold cursor-pointer transition ${
                  action.primary ? 'bg-brand text-white' : action.danger ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400' : 'bg-tint text-brand'}`}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// 结果反馈：简短 Toast
export function useToast() {
  const [text, setText] = useState('')
  const timerRef = useRef(null)
  useEffect(() => () => clearTimeout(timerRef.current), [])
  function show(message) {
    setText(message)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setText(''), 2200)
  }
  const node = text ? (
    <div role="status" className="fixed left-1/2 -translate-x-1/2 z-[80] px-4 py-2.5 rounded-full bg-ink text-surface text-[13px] shadow-lg pointer-events-none"
      style={{ bottom: 'calc(96px + var(--safe-bottom))' }}>
      {text}
    </div>
  ) : null
  return [node, show]
}

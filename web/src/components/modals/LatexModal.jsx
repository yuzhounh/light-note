import React, { useState, useEffect, useRef } from 'react'
import { X, Trash2, Check, Sparkles, Code2, Eye } from 'lucide-react'
import katex from 'katex'

const COMMON_SYMBOLS = [
  { label: '分数', code: '\\frac{a}{b}' },
  { label: '根号', code: '\\sqrt{x}' },
  { label: '上标', code: 'x^{2}' },
  { label: '下标', code: 'x_{i}' },
  { label: '求和', code: '\\sum_{i=1}^{n}' },
  { label: '积分', code: '\\int_{a}^{b} f(x) dx' },
  { label: '极限', code: '\\lim_{x \\to 0}' },
  { label: '矩阵', code: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
  { label: '±', code: '\\pm ' },
  { label: '×', code: '\\times ' },
  { label: '÷', code: '\\div ' },
  { label: '≠', code: '\\neq ' },
  { label: '≤', code: '\\le ' },
  { label: '≥', code: '\\ge ' },
  { label: '∞', code: '\\infty ' },
  { label: 'α', code: '\\alpha ' },
  { label: 'β', code: '\\beta ' },
  { label: 'π', code: '\\pi ' },
  { label: 'θ', code: '\\theta ' },
  { label: '→', code: '\\rightarrow ' },
]

export function LatexModal({
  isOpen,
  initialLatex = '',
  initialIsBlock = false,
  isExisting = false,
  onClose,
  onSave,
  onDelete
}) {
  const [latex, setLatex] = useState(initialLatex)
  const [isBlock, setIsBlock] = useState(initialIsBlock)
  const [renderError, setRenderError] = useState('')
  const [previewHtml, setPreviewHtml] = useState('')
  const textareaRef = useRef(null)

  // Sync state when modal opens
  useEffect(() => {
    if (isOpen) {
      setLatex(initialLatex || '')
      setIsBlock(initialIsBlock || false)
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          textareaRef.current.select()
        }
      }, 50)
    }
  }, [isOpen, initialLatex, initialIsBlock])

  // Real-time KaTeX rendering
  useEffect(() => {
    if (!latex.trim()) {
      setPreviewHtml('')
      setRenderError('')
      return
    }

    try {
      const html = katex.renderToString(latex, {
        throwOnError: true,
        displayMode: isBlock,
      })
      setPreviewHtml(html)
      setRenderError('')
    } catch (err) {
      // If error occurs with throwOnError, attempt non-throwing render for partial view
      try {
        const fallback = katex.renderToString(latex, {
          throwOnError: false,
          displayMode: isBlock,
        })
        setPreviewHtml(fallback)
      } catch {
        setPreviewHtml('')
      }
      setRenderError(err.message || 'LaTeX 语法有误')
    }
  }, [latex, isBlock])

  if (!isOpen) return null

  function handleInsertSnippet(snippetCode) {
    const textarea = textareaRef.current
    if (!textarea) {
      setLatex(prev => prev + snippetCode)
      return
    }

    const start = textarea.selectionStart ?? latex.length
    const end = textarea.selectionEnd ?? latex.length
    const nextVal = latex.slice(0, start) + snippetCode + latex.slice(end)
    setLatex(nextVal)

    // Restore focus and position cursor after inserted snippet
    setTimeout(() => {
      textarea.focus()
      const newPos = start + snippetCode.length
      textarea.setSelectionRange(newPos, newPos)
    }, 0)
  }

  function handleKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  function handleSave() {
    const trimmed = latex.trim()
    if (!trimmed) {
      if (isExisting && onDelete) {
        onDelete()
      } else {
        onClose()
      }
      return
    }
    onSave({ latex: trimmed, isBlock })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 dark:bg-black/70 backdrop-blur-sm select-none">
      <div 
        className="w-full max-w-2xl max-h-[90vh] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-500 rounded-2xl shadow-2xl dark:shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_25px_60px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-serif italic font-bold text-base text-zinc-900 dark:text-zinc-100 px-1">
              fx
            </span>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {isExisting ? '编辑 LaTeX 数学公式' : '插入 LaTeX 数学公式'}
            </h3>
          </div>

          {/* Mode switch pills */}
          <div className="flex items-center gap-1 p-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
            <button
              type="button"
              onClick={() => setIsBlock(false)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                !isBlock
                  ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              行内公式 ($)
            </button>
            <button
              type="button"
              onClick={() => setIsBlock(true)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                isBlock
                  ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              独立公式块 ($$)
            </button>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
            title="关闭 (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Two-Column Split Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Left Column: Code Input */}
          <div className="flex flex-col gap-2 min-h-0">
            <div className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400 font-medium">
              <span className="flex items-center gap-1.5">
                <Code2 size={14} />
                <span>LaTeX 源码</span>
              </span>
              <span className="text-[11px] text-zinc-400 font-normal">支持常用 KaTeX 语法</span>
            </div>

            <textarea
              ref={textareaRef}
              value={latex}
              onChange={e => setLatex(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入 LaTeX 公式，例如：E = mc^2 或 \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}"
              rows={6}
              spellCheck={false}
              className="w-full h-36 sm:h-44 p-3 bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 focus:border-zinc-400 dark:focus:border-zinc-600 rounded-xl font-mono text-xs sm:text-[13px] leading-relaxed text-zinc-900 dark:text-zinc-100 outline-none resize-none transition"
            />

            {/* Quick Symbol Snippets */}
            <div className="space-y-1">
              <div className="text-[11px] text-zinc-400 flex items-center gap-1">
                <Sparkles size={11} />
                <span>常用符号速选：</span>
              </div>
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto no-scrollbar py-0.5">
                {COMMON_SYMBOLS.map(sym => (
                  <button
                    key={sym.label}
                    type="button"
                    onClick={() => handleInsertSnippet(sym.code)}
                    className="px-2 py-0.5 bg-zinc-100 hover:bg-zinc-200/80 dark:bg-zinc-800 dark:hover:bg-zinc-700/80 rounded text-[11px] text-zinc-700 dark:text-zinc-300 font-mono transition cursor-pointer"
                    title={sym.code}
                  >
                    {sym.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Live Rendered Preview */}
          <div className="flex flex-col gap-2 min-h-0">
            <div className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400 font-medium">
              <span className="flex items-center gap-1.5">
                <Eye size={14} />
                <span>实时渲染效果</span>
              </span>
              {renderError && (
                <span className="text-[11px] text-rose-500 truncate max-w-[140px]" title={renderError}>
                  语法解析提示
                </span>
              )}
            </div>

            <div className="w-full h-36 sm:h-44 flex items-center justify-center p-4 bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-auto text-zinc-900 dark:text-zinc-100">
              {previewHtml ? (
                <div 
                  className={`max-w-full overflow-x-auto py-2 text-center ${isBlock ? 'text-lg' : 'text-base'}`}
                  dangerouslySetInnerHTML={{ __html: previewHtml }} 
                />
              ) : (
                <span className="text-xs text-zinc-400 text-center select-none">
                  （在左侧输入 LaTeX 代码以实时预览公式）
                </span>
              )}
            </div>

            {/* Error / Hint bar */}
            <div className="min-h-[22px] flex items-center">
              {renderError ? (
                <p className="text-[11px] text-rose-500 font-mono truncate" title={renderError}>
                  {renderError}
                </p>
              ) : (
                <p className="text-[11px] text-zinc-400">
                  支持矩阵、积分、上下标及希腊字母等标准数学公式排版
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 shrink-0">
          <div>
            {isExisting && onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100/80 dark:bg-rose-950/40 dark:hover:bg-rose-950/70 text-rose-600 dark:text-rose-400 rounded-lg text-xs font-medium transition cursor-pointer"
              >
                <Trash2 size={13} />
                <span>删除公式</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-[11px] text-zinc-400 mr-2">
              按 Ctrl + Enter 快速保存
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-medium transition cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium shadow-xs transition cursor-pointer"
            >
              <Check size={13} />
              <span>{isExisting ? '保存修改' : '插入公式'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

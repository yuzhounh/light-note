import React, { useEffect, useState, useRef, useImperativeHandle, forwardRef } from 'react'
import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import { Node, Mark, mergeAttributes } from '@tiptap/core'
import katex from 'katex'
import { LatexModal } from '../components/modals/LatexModal'
import { syncService } from '../core/sync/syncService'

// 1. Underline Mark
const Underline = Mark.create({
  name: 'underline',
  parseHTML: () => [{ tag: 'u' }],
  renderHTML: ({ HTMLAttributes }) => ['u', mergeAttributes(HTMLAttributes), 0],
  addCommands() {
    return {
      toggleUnderline: () => ({ commands }) => commands.toggleMark(this.name),
    }
  },
  addKeyboardShortcuts() {
    return { 'Mod-u': () => this.editor.commands.toggleUnderline() }
  },
})

// 2. TextAppearance Mark (fontFamily, fontSize, highlight)
const TextAppearance = Mark.create({
  name: 'textAppearance',
  addAttributes() {
    return {
      fontFamily: {
        default: null,
        parseHTML: element => element.style.fontFamily || null,
      },
      fontSize: {
        default: null,
        parseHTML: element => element.style.fontSize || null,
      },
      backgroundColor: {
        default: null,
        parseHTML: element => element.style.backgroundColor || null,
      },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'span[style]',
        getAttrs: element => {
          if (element.hasAttribute('data-type')) return false
          const { fontFamily, fontSize, backgroundColor } = element.style
          return fontFamily || fontSize || backgroundColor ? {} : false
        },
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    const style = [
      HTMLAttributes.fontFamily ? `font-family: ${HTMLAttributes.fontFamily}` : '',
      HTMLAttributes.fontSize ? `font-size: ${HTMLAttributes.fontSize}` : '',
      HTMLAttributes.backgroundColor ? `background-color: ${HTMLAttributes.backgroundColor}` : '',
    ].filter(Boolean).join('; ')
    return ['span', style ? { style } : {}, 0]
  },
  addCommands() {
    return {
      setFontFamily: fontFamily => ({ commands }) => commands.setMark(this.name, { fontFamily }),
      setFontSize: fontSize => ({ commands }) => commands.setMark(this.name, { fontSize }),
      toggleHighlight: () => ({ editor, commands }) => {
        const isHighlighted = editor.isActive(this.name, { backgroundColor: '#fff2a8' })
        return commands.setMark(this.name, {
          backgroundColor: isHighlighted ? null : '#fff2a8',
        })
      },
    }
  },
})

// 3. KaTeX Math Node
export const MathNode = Node.create({
  name: 'mathNode',
  group: 'inline',
  inline: true,
  selectable: true,
  atom: true,

  addAttributes() {
    return {
      latex: {
        default: 'E = mc^2',
        parseHTML: element => element.getAttribute('data-latex') || element.textContent,
        renderHTML: attributes => ({
          'data-latex': attributes.latex,
          'data-block': attributes.isBlock ? 'true' : 'false',
          class: attributes.isBlock ? 'math-node math-node-block' : 'math-node'
        })
      },
      isBlock: {
        default: false,
        parseHTML: element => element.getAttribute('data-block') === 'true',
        renderHTML: attributes => ({
          'data-block': attributes.isBlock ? 'true' : 'false'
        })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-latex]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), HTMLAttributes['data-latex'] || '']
  },

  addNodeView() {
    return ({ node, getPos }) => {
      const dom = document.createElement('span')
      const isBlock = !!node.attrs.isBlock
      dom.className = isBlock
        ? 'math-node block my-2 py-1 px-2 text-center overflow-x-auto cursor-pointer hover:bg-zinc-100/80 dark:hover:bg-zinc-800/80 rounded-lg transition'
        : 'math-node inline-block px-1 py-0.5 align-middle cursor-pointer hover:bg-zinc-100/80 dark:hover:bg-zinc-800/80 rounded transition'
      dom.setAttribute('data-latex', node.attrs.latex || '')
      dom.setAttribute('data-block', isBlock ? 'true' : 'false')
      dom.title = '点击编辑数学公式'
      
      try {
        katex.render(node.attrs.latex || '', dom, { throwOnError: false, displayMode: isBlock })
      } catch (err) {
        dom.textContent = node.attrs.latex
      }

      dom.addEventListener('click', (e) => {
        e.stopPropagation()
        if (typeof window.__openMathDialog === 'function') {
          window.__openMathDialog({
            latex: node.attrs.latex || '',
            isBlock,
            pos: typeof getPos === 'function' ? getPos() : null,
            isExisting: true,
          })
        }
      })

      return { dom }
    }
  }
})

// 4. Resizable Image View Component with Quick Presets, Drag Handle and Lightbox
function ResizableImageComponent({ node, updateAttributes, selected, deleteNode }) {
  const [resolvedSrc, setResolvedSrc] = useState(node.attrs.src || '')
  const [isResizing, setIsResizing] = useState(false)
  const [hovered, setHovered] = useState(false)
  const imageRef = useRef(null)
  const containerRef = useRef(null)

  useEffect(() => {
    let active = true
    if (node.attrs.src && node.attrs.src.startsWith('https://lightnote.attachments/')) {
      syncService.resolveImageUrl(node.attrs.src).then(resolved => {
        if (active && resolved) {
          setResolvedSrc(resolved)
        }
      })
    } else {
      setResolvedSrc(node.attrs.src || '')
    }
    return () => { active = false }
  }, [node.attrs.src])

  const handleResizeStart = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    const startX = e.clientX
    const startWidth = containerRef.current ? containerRef.current.offsetWidth : (imageRef.current ? imageRef.current.offsetWidth : 300)
    const parentWidth = containerRef.current?.parentElement?.offsetWidth || window.innerWidth

    const onMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX
      const newWidth = Math.max(80, Math.min(parentWidth, startWidth + deltaX))
      if (containerRef.current) {
        containerRef.current.style.width = `${newWidth}px`
      }
    }

    const onMouseUp = (upEvent) => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      setIsResizing(false)
      const deltaX = upEvent.clientX - startX
      const finalWidth = Math.max(80, Math.min(parentWidth, startWidth + deltaX))
      updateAttributes({ width: `${Math.round(finalWidth)}px` })
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const handleSetPresetWidth = (widthVal, e) => {
    e.preventDefault()
    e.stopPropagation()
    updateAttributes({ width: widthVal })
  }

  const handleDoubleClick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (typeof window.__openImageLightbox === 'function') {
      window.__openImageLightbox(resolvedSrc)
    }
  }

  const currentWidth = node.attrs.width || '100%'

  return (
    <NodeViewWrapper
      as="span"
      ref={containerRef}
      style={{ width: currentWidth, maxWidth: '100%', display: 'inline-block' }}
      className="inline-block relative my-2 max-w-full group select-none align-middle"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        style={{ width: '100%', display: 'inline-block' }}
        className={`relative inline-block max-w-full rounded-lg overflow-visible ${
          selected ? 'ring-2 ring-amber-500 ring-offset-2' : ''
        }`}
      >
        <img
          ref={imageRef}
          src={resolvedSrc}
          alt={node.attrs.alt || ''}
          data-attachment-id={node.attrs['data-attachment-id']}
          style={{ width: '100%', maxWidth: '100%', display: 'block' }}
          className="rounded-lg shadow-xs cursor-pointer object-contain transition-all"
          onDoubleClick={handleDoubleClick}
        />

        {/* Floating Quick Action Toolbar */}
        {(hovered || selected || isResizing) && (
          <span className="absolute top-2 right-2 bg-white/95 dark:bg-zinc-800/95 backdrop-blur-sm border border-zinc-200 dark:border-zinc-700 rounded-md shadow-md py-0.5 px-1.5 flex items-center gap-1 text-[11px] z-20">
            <button
              type="button"
              onClick={(e) => handleSetPresetWidth('25%', e)}
              className={`px-1.5 py-0.5 rounded transition ${currentWidth === '25%' ? 'bg-amber-100 text-amber-800 font-bold dark:bg-amber-900/60 dark:text-amber-200' : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300'}`}
              title="25% 宽度"
            >
              25%
            </button>
            <button
              type="button"
              onClick={(e) => handleSetPresetWidth('50%', e)}
              className={`px-1.5 py-0.5 rounded transition ${currentWidth === '50%' ? 'bg-amber-100 text-amber-800 font-bold dark:bg-amber-900/60 dark:text-amber-200' : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300'}`}
              title="50% 宽度"
            >
              50%
            </button>
            <button
              type="button"
              onClick={(e) => handleSetPresetWidth('75%', e)}
              className={`px-1.5 py-0.5 rounded transition ${currentWidth === '75%' ? 'bg-amber-100 text-amber-800 font-bold dark:bg-amber-900/60 dark:text-amber-200' : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300'}`}
              title="75% 宽度"
            >
              75%
            </button>
            <button
              type="button"
              onClick={(e) => handleSetPresetWidth('100%', e)}
              className={`px-1.5 py-0.5 rounded transition ${currentWidth === '100%' ? 'bg-amber-100 text-amber-800 font-bold dark:bg-amber-900/60 dark:text-amber-200' : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300'}`}
              title="100% 原始/全宽"
            >
              100%
            </button>
            <span className="w-[1px] h-3 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />
            <button
              type="button"
              onClick={handleDoubleClick}
              className="px-1.5 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition"
              title="查看大图"
            >
              🔍
            </button>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteNode?.() }}
              className="px-1.5 py-0.5 rounded hover:bg-red-50 text-red-600 dark:hover:bg-red-950/40 dark:text-red-400 transition"
              title="删除图片"
            >
              🗑️
            </button>
          </span>
        )}

        {/* Bottom-right Drag Resize Handle */}
        {(hovered || selected || isResizing) && (
          <span
            onMouseDown={handleResizeStart}
            className="absolute bottom-1 right-1 w-4 h-4 bg-amber-500 text-white rounded-full flex items-center justify-center cursor-se-resize shadow-md hover:scale-125 transition-transform z-20"
            title="拖拽调节大小"
          >
            <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M21 15v6h-6M21 21l-9-9" />
            </svg>
          </span>
        )}
      </span>
    </NodeViewWrapper>
  )
}

// Custom Image Node with width attribute and Resizable Image View
const CustomImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
      },
      width: {
        default: null,
        parseHTML: element => element.getAttribute('width') || element.style.width || null,
        renderHTML: attributes => {
          if (!attributes.width) return {}
          return {
            width: attributes.width,
            style: `width: ${attributes.width}`,
          }
        },
      },
      'data-attachment-id': {
        default: null,
      }
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageComponent)
  }
})

const FONT_FAMILIES = [
  { label: '微软雅黑', value: 'Microsoft YaHei, sans-serif' },
  { label: '宋体', value: 'SimSun, serif' },
  { label: '黑体', value: 'SimHei, sans-serif' },
  { label: '楷体', value: 'KaiTi, serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Consolas', value: 'Consolas, monospace' },
]

const FONT_SIZES = ['11', '12', '13', '14', '15', '16', '18', '20', '24']

export const LightEditor = forwardRef(function LightEditor(
  { title, onUpdateTitle, content, onChange, isMobile = false, autoFocus = false, onFocused },
  ref
) {
  const [selectedFont, setSelectedFont] = useState('微软雅黑')
  const [selectedSize, setSelectedSize] = useState('12')
  const [lightboxSrc, setLightboxSrc] = useState(null)

  const titleInputRef = useRef(null)
  const lastDispatchedHtml = useRef(content || '')

  useEffect(() => {
    window.__openImageLightbox = (src) => setLightboxSrc(src)
    return () => {
      delete window.__openImageLightbox
    }
  }, [])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      TextAppearance,
      MathNode,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer',
          class: 'text-blue-600 dark:text-blue-400 underline underline-offset-2 hover:text-blue-800 dark:hover:text-blue-300 cursor-pointer transition',
          title: 'Ctrl + 单击在浏览器中打开链接',
        },
      }),
      CustomImage.configure({
        inline: true,
        allowBase64: true,
      }),
    ],
    content: content || '',
    editorProps: {
      attributes: {
        class: 'focus:outline-none min-h-[400px] text-zinc-900 dark:text-zinc-100 text-[14.5px] leading-[1.65]',
      },
      handleClick: (view, pos, event) => {
        const a = event.target.closest('a')
        if (a && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          const href = a.getAttribute('href')
          if (href) {
            window.open(href, '_blank', 'noopener,noreferrer')
            return true
          }
        }
        return false
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Backspace' || event.key === 'ArrowUp') {
          const { from, to } = view.state.selection
          if (from === 1 && to === 1) {
            event.preventDefault()
            if (titleInputRef.current) {
              titleInputRef.current.focus()
              const len = titleInputRef.current.value.length
              titleInputRef.current.setSelectionRange(len, len)
            }
            return true
          }
        }
        return false
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items
        if (!items) return false
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile()
            if (file) {
              const reader = new FileReader()
              reader.onload = e => {
                const src = e.target.result
                view.dispatch(
                  view.state.tr.replaceSelectionWith(
                    view.state.schema.nodes.image.create({ src })
                  )
                )
              }
              reader.readAsDataURL(file)
              return true
            }
          }
        }
        return false
      },
      handleDrop: (view, event) => {
        const files = event.dataTransfer?.files
        if (files && files.length > 0 && files[0].type.startsWith('image/')) {
          const reader = new FileReader()
          reader.onload = e => {
            const src = e.target.result
            view.dispatch(
              view.state.tr.replaceSelectionWith(
                view.state.schema.nodes.image.create({ src })
              )
            )
          }
          reader.readAsDataURL(files[0])
          return true
        }
        return false
      },
    },
    onSelectionUpdate: ({ editor }) => {
      const attrs = editor.getAttributes('textAppearance')
      if (attrs.fontFamily) {
        const found = FONT_FAMILIES.find(f => f.value === attrs.fontFamily || attrs.fontFamily.includes(f.label))
        if (found) setSelectedFont(found.label)
      } else {
        setSelectedFont('微软雅黑')
      }

      if (attrs.fontSize) {
        const sizeNum = String(attrs.fontSize).replace(/[^0-9]/g, '')
        if (sizeNum && FONT_SIZES.includes(sizeNum)) {
          setSelectedSize(sizeNum)
        }
      } else {
        setSelectedSize('12')
      }
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      lastDispatchedHtml.current = html
      if (onChange) {
        onChange({
          html,
          text: editor.getText(),
        })
      }
    },
  })

  useImperativeHandle(ref, () => ({
    focus: (position = 'start') => {
      if (position === 'start' || position === 'end' || position === 'all') {
        editor?.commands.focus(position)
      } else {
        editor?.commands.focus()
      }
    },
    getEditor: () => editor,
  }))

  useEffect(() => {
    if (editor && content !== undefined) {
      if (content !== lastDispatchedHtml.current && editor.getHTML() !== content) {
        lastDispatchedHtml.current = content
        editor.commands.setContent(content || '', false)
      }
    }
  }, [content, editor])

  useEffect(() => {
    if (autoFocus && editor) {
      const timer = setTimeout(() => {
        editor.commands.focus('start')
        if (onFocused) onFocused()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [autoFocus, editor, onFocused])

  if (!editor) return null

  function handleFontChange(val) {
    setSelectedFont(val)
    const found = FONT_FAMILIES.find(f => f.label === val)
    if (found) {
      editor.chain().focus().setFontFamily(found.value).run()
    }
  }

  function handleSizeChange(val) {
    setSelectedSize(val)
    editor.chain().focus().setFontSize(`${val}pt`).run()
  }

  const [mathModal, setMathModal] = useState({
    isOpen: false,
    latex: '',
    isBlock: false,
    pos: null,
    isExisting: false,
  })

  useEffect(() => {
    window.__openMathDialog = (payload) => {
      setMathModal({
        isOpen: true,
        latex: payload.latex || '',
        isBlock: !!payload.isBlock,
        pos: payload.pos ?? null,
        isExisting: !!payload.isExisting,
      })
    }
    return () => {
      delete window.__openMathDialog
    }
  }, [])

  function handleInsertMath() {
    if (!editor) return
    const { from, to } = editor.state.selection
    const selectedText = from < to ? editor.state.doc.textBetween(from, to) : ''
    setMathModal({
      isOpen: true,
      latex: selectedText || 'E = mc^2',
      isBlock: false,
      pos: null,
      isExisting: false,
    })
  }

  function handleSaveMath({ latex, isBlock }) {
    if (!editor) return
    if (mathModal.isExisting && typeof mathModal.pos === 'number') {
      editor.commands.command(({ tr }) => {
        tr.setNodeMarkup(mathModal.pos, undefined, { latex, isBlock })
        return true
      })
    } else {
      editor.chain().focus().insertContent({
        type: 'mathNode',
        attrs: { latex, isBlock }
      }).run()
    }
    setMathModal(prev => ({ ...prev, isOpen: false }))
    editor.commands.focus()
  }

  function handleDeleteMath() {
    if (!editor) return
    if (mathModal.isExisting && typeof mathModal.pos === 'number') {
      editor.commands.command(({ tr }) => {
        const node = tr.doc.nodeAt(mathModal.pos)
        if (node) {
          tr.delete(mathModal.pos, mathModal.pos + node.nodeSize)
        }
        return true
      })
    }
    setMathModal(prev => ({ ...prev, isOpen: false }))
    editor.commands.focus()
  }

  function handleInsertTimestamp() {
    if (!editor) return
    const d = new Date()
    const pad = n => String(n).padStart(2, '0')
    const timestamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    const { from } = editor.state.selection
    editor.chain().focus().insertContent(timestamp).setTextSelection(from + timestamp.length).run()
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900 overflow-hidden">
      {/* 1:1 Parity Desktop Toolbar */}
      <div className="flex items-center gap-1.5 px-6 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs select-none overflow-x-auto shrink-0 whitespace-nowrap no-scrollbar">

        {/* Font Family Dropdown */}
        <select
          value={selectedFont}
          onChange={e => handleFontChange(e.target.value)}
          className="h-[26px] bg-transparent border border-zinc-200 dark:border-zinc-700 rounded-md px-1.5 text-xs text-zinc-800 dark:text-zinc-200 outline-none hover:bg-zinc-50 dark:hover:bg-zinc-700 dark:hover:text-zinc-100 cursor-pointer shrink-0 whitespace-nowrap transition"
        >
          {FONT_FAMILIES.map(f => (
            <option key={f.label} value={f.label}>{f.label}</option>
          ))}
        </select>

        {/* Font Size Dropdown */}
        <select
          value={selectedSize}
          onChange={e => handleSizeChange(e.target.value)}
          className="h-[26px] bg-transparent border border-zinc-200 dark:border-zinc-700 rounded-md px-1.5 text-xs text-zinc-800 dark:text-zinc-200 outline-none hover:bg-zinc-50 dark:hover:bg-zinc-700 dark:hover:text-zinc-100 cursor-pointer shrink-0 whitespace-nowrap transition"
        >
          {FONT_SIZES.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <div className="w-[1px] h-3.5 bg-zinc-200 dark:bg-zinc-700 mx-0.5 shrink-0" />

        {/* Paragraph (appropriately sized for text) */}
        <button
          onClick={() => editor.chain().focus().setParagraph().run()}
          className={`h-[26px] px-2.5 rounded-md flex items-center justify-center transition text-xs shrink-0 whitespace-nowrap cursor-pointer ${
            editor.isActive('paragraph') && !editor.isActive('heading')
              ? 'bg-zinc-200/90 dark:bg-zinc-500 dark:hover:bg-zinc-500 text-zinc-900 dark:text-white font-medium shadow-xs'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 dark:hover:text-zinc-100 font-normal'
          }`}
        >
          正文
        </button>

        {/* Headings: uniform 26x26 square */}
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={`w-[26px] h-[26px] rounded-md flex items-center justify-center transition text-xs shrink-0 whitespace-nowrap cursor-pointer ${
            editor.isActive('heading', { level: 1 })
              ? 'bg-zinc-200/90 dark:bg-zinc-500 dark:hover:bg-zinc-500 text-zinc-900 dark:text-white font-medium shadow-xs'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 dark:hover:text-zinc-100 font-normal'
          }`}
        >
          H₁
        </button>

        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={`w-[26px] h-[26px] rounded-md flex items-center justify-center transition text-xs shrink-0 whitespace-nowrap cursor-pointer ${
            editor.isActive('heading', { level: 2 })
              ? 'bg-zinc-200/90 dark:bg-zinc-500 dark:hover:bg-zinc-500 text-zinc-900 dark:text-white font-medium shadow-xs'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 dark:hover:text-zinc-100 font-normal'
          }`}
        >
          H₂
        </button>

        <div className="w-[1px] h-3.5 bg-zinc-200 dark:bg-zinc-700 mx-0.5 shrink-0" />

        {/* Inline styles: uniform 26x26 square */}
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`w-[26px] h-[26px] rounded-md flex items-center justify-center font-bold text-xs shrink-0 whitespace-nowrap transition cursor-pointer ${
            editor.isActive('bold')
              ? 'bg-zinc-200/90 dark:bg-zinc-500 dark:hover:bg-zinc-500 text-zinc-900 dark:text-white shadow-xs'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 dark:hover:text-zinc-100'
          }`}
          title="粗体 (Ctrl+B)"
        >
          B
        </button>

        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`w-[26px] h-[26px] rounded-md flex items-center justify-center italic text-xs shrink-0 whitespace-nowrap transition cursor-pointer ${
            editor.isActive('italic')
              ? 'bg-zinc-200/90 dark:bg-zinc-500 dark:hover:bg-zinc-500 text-zinc-900 dark:text-white shadow-xs'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 dark:hover:text-zinc-100'
          }`}
          title="斜体 (Ctrl+I)"
        >
          /
        </button>

        <button
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={`w-[26px] h-[26px] rounded-md flex items-center justify-center underline text-xs shrink-0 whitespace-nowrap transition cursor-pointer ${
            editor.isActive('underline')
              ? 'bg-zinc-200/90 dark:bg-zinc-500 dark:hover:bg-zinc-500 text-zinc-900 dark:text-white shadow-xs'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 dark:hover:text-zinc-100'
          }`}
          title="下划线 (Ctrl+U)"
        >
          U
        </button>

        <button
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={`w-[26px] h-[26px] rounded-md flex items-center justify-center line-through text-xs shrink-0 whitespace-nowrap transition cursor-pointer ${
            editor.isActive('strike')
              ? 'bg-zinc-200/90 dark:bg-zinc-500 dark:hover:bg-zinc-500 text-zinc-900 dark:text-white shadow-xs'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 dark:hover:text-zinc-100'
          }`}
          title="删除线"
        >
          ab
        </button>

        <button
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          className={`relative w-[26px] h-[26px] rounded-md flex flex-col items-center justify-center text-xs shrink-0 whitespace-nowrap transition cursor-pointer ${
            editor.isActive('highlight')
              ? 'bg-zinc-200/90 dark:bg-zinc-500 dark:hover:bg-zinc-500 text-zinc-900 dark:text-white shadow-xs'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 dark:hover:text-zinc-100'
          }`}
          title="文本荧光高亮"
        >
          <span className="leading-none text-[11px]">ab</span>
          <span className="w-3.5 h-[2px] bg-amber-400 rounded-full mt-0.5" />
        </button>

        <button
          onClick={handleInsertMath}
          className="w-[26px] h-[26px] rounded-md flex items-center justify-center italic font-serif text-xs font-semibold shrink-0 whitespace-nowrap hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 dark:hover:text-zinc-100 transition cursor-pointer"
          title="插入数学公式 (KaTeX)"
        >
          fx
        </button>

        <div className="w-[1px] h-3.5 bg-zinc-200 dark:bg-zinc-700 mx-0.5 shrink-0" />

        {/* Lists & Quote: uniform 26x26 square */}
        <button
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`w-[26px] h-[26px] rounded-md flex items-center justify-center text-xs shrink-0 whitespace-nowrap transition cursor-pointer ${
            editor.isActive('bulletList')
              ? 'bg-zinc-200/90 dark:bg-zinc-500 dark:hover:bg-zinc-500 text-zinc-900 dark:text-white shadow-xs'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 dark:hover:text-zinc-100'
          }`}
          title="无序列表"
        >
          •☰
        </button>

        <button
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`w-[26px] h-[26px] rounded-md flex items-center justify-center text-xs shrink-0 whitespace-nowrap transition cursor-pointer ${
            editor.isActive('orderedList')
              ? 'bg-zinc-200/90 dark:bg-zinc-500 dark:hover:bg-zinc-500 text-zinc-900 dark:text-white shadow-xs'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 dark:hover:text-zinc-100'
          }`}
          title="编号列表"
        >
          1☰
        </button>

        <button
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={`w-[26px] h-[26px] rounded-md flex items-center justify-center text-xs shrink-0 whitespace-nowrap transition cursor-pointer ${
            editor.isActive('blockquote')
              ? 'bg-zinc-200/90 dark:bg-zinc-500 dark:hover:bg-zinc-500 text-zinc-900 dark:text-white shadow-xs'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 dark:hover:text-zinc-100'
          }`}
          title="引用"
        >
          ❞
        </button>

        {/* Code block */}
        <button
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          className={`w-[26px] h-[26px] rounded-md flex items-center justify-center text-xs shrink-0 whitespace-nowrap transition cursor-pointer ${
            editor.isActive('codeBlock')
              ? 'bg-zinc-200/90 dark:bg-zinc-500 dark:hover:bg-zinc-500 text-zinc-900 dark:text-white shadow-xs'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 dark:hover:text-zinc-100'
          }`}
          title="代码块"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m18 16 4-4-4-4" />
            <path d="m6 8-4 4 4 4" />
            <path d="m14.5 4-5 16" />
          </svg>
        </button>

        {/* Timestamp */}
        <button
          onClick={handleInsertTimestamp}
          className="w-[26px] h-[26px] rounded-md flex items-center justify-center text-xs shrink-0 whitespace-nowrap transition cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 dark:hover:text-zinc-100"
          title="插入当前时间"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        </button>
      </div>

      {/* Editor Content Area: Title is directly below toolbar, strictly left-aligned at px-6 */}
      <div
        className="flex-1 overflow-y-auto px-6 py-5 flex flex-col cursor-text"
        onClick={e => {
          // If the user has selected text via mouse drag, do NOT refocus or alter selection
          const sel = window.getSelection()
          if (sel && !sel.isCollapsed && sel.toString().length > 0) {
            return
          }

          if (
            e.target.closest('input') ||
            e.target.closest('button') ||
            e.target.closest('a') ||
            e.target.closest('.math-node') ||
            e.target.closest('.math-modal-card')
          ) {
            return
          }
          if (!editor) return

          if (editor.isEmpty) {
            editor.commands.focus('start')
            return
          }

          // If clicking strictly on the outer container below the editor content
          if (e.target === e.currentTarget) {
            editor.commands.focus('end')
            return
          }

          // If clicking on the ProseMirror root container itself
          if (e.target === editor.view.dom) {
            const lastChild = editor.view.dom.lastElementChild
            if (lastChild) {
              const rect = lastChild.getBoundingClientRect()
              // Only focus end if click is physically below the last paragraph/element
              if (e.clientY > rect.bottom) {
                editor.commands.focus('end')
              }
            }
          }
        }}
      >
        <input
          ref={titleInputRef}
          type="text"
          placeholder="无标题"
          value={title || ''}
          onChange={e => onUpdateTitle && onUpdateTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowDown') {
              e.preventDefault()
              editor?.commands.focus('start')
            }
          }}
          className="w-full text-[21px] font-bold bg-transparent outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-300 dark:placeholder:text-zinc-700 mb-3 tracking-tight shrink-0 cursor-text"
        />
        <EditorContent editor={editor} className="tiptap-editor-wrapper flex-1 flex flex-col cursor-text" />
      </div>

      {/* Interactive LaTeX Formula Modal with Left Code & Right Live Preview */}
      <LatexModal
        isOpen={mathModal.isOpen}
        initialLatex={mathModal.latex}
        initialIsBlock={mathModal.isBlock}
        isExisting={mathModal.isExisting}
        onClose={() => {
          setMathModal(prev => ({ ...prev, isOpen: false }))
          editor?.commands.focus()
        }}
        onSave={handleSaveMath}
        onDelete={handleDeleteMath}
      />

      {/* Fullscreen Image Lightbox Modal */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out select-none"
          onClick={() => setLightboxSrc(null)}
        >
          <button
            onClick={() => setLightboxSrc(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 p-2 rounded-full transition cursor-pointer"
            title="关闭 (Esc)"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
          <img
            src={lightboxSrc}
            alt="大图预览"
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg shadow-2xl cursor-default"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
})

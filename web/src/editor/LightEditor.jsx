import React, { useEffect, useState, useImperativeHandle, forwardRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Node, Mark, mergeAttributes } from '@tiptap/core'
import katex from 'katex'
import { LatexModal } from '../components/modals/LatexModal'

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
        ? 'math-node block my-2 py-1 px-2 text-center overflow-x-auto select-none cursor-pointer hover:bg-zinc-100/80 dark:hover:bg-zinc-800/80 rounded-lg transition'
        : 'math-node inline-block px-1 py-0.5 align-middle select-none cursor-pointer hover:bg-zinc-100/80 dark:hover:bg-zinc-800/80 rounded transition'
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
  { title, onUpdateTitle, content, onChange, isMobile = false },
  ref
) {
  const [selectedFont, setSelectedFont] = useState('微软雅黑')
  const [selectedSize, setSelectedSize] = useState('12')

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      TextAppearance,
      MathNode,
      Image.configure({
        inline: true,
        allowBase64: true,
      }),
    ],
    content: content || '',
    editorProps: {
      attributes: {
        class: 'focus:outline-none min-h-[400px] text-zinc-900 dark:text-zinc-100 text-[14.5px] leading-[1.65]',
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
    onUpdate: ({ editor }) => {
      if (onChange) {
        onChange({
          html: editor.getHTML(),
          text: editor.getText(),
        })
      }
    },
  })

  useImperativeHandle(ref, () => ({
    focus: () => {
      editor?.commands.focus()
    },
    getEditor: () => editor,
  }))

  useEffect(() => {
    if (editor && content !== undefined && editor.getHTML() !== content) {
      editor.commands.setContent(content || '', false)
    }
  }, [content, editor])

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

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900 overflow-hidden">
      {/* 1:1 Parity Desktop Toolbar */}
      <div className="flex items-center gap-1.5 px-6 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs select-none overflow-x-auto shrink-0 whitespace-nowrap no-scrollbar">
        {/* Font Family Dropdown */}
        <select
          value={selectedFont}
          onChange={e => handleFontChange(e.target.value)}
          className="h-[26px] bg-transparent border border-zinc-200 dark:border-zinc-700 rounded-md px-1.5 text-xs text-zinc-800 dark:text-zinc-200 outline-none hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer shrink-0 whitespace-nowrap"
        >
          {FONT_FAMILIES.map(f => (
            <option key={f.label} value={f.label}>{f.label}</option>
          ))}
        </select>

        {/* Font Size Dropdown */}
        <select
          value={selectedSize}
          onChange={e => handleSizeChange(e.target.value)}
          className="h-[26px] bg-transparent border border-zinc-200 dark:border-zinc-700 rounded-md px-1.5 text-xs text-zinc-800 dark:text-zinc-200 outline-none hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer shrink-0 whitespace-nowrap"
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
              ? 'bg-zinc-200/90 dark:bg-zinc-700 text-zinc-900 dark:text-white font-medium'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-normal'
          }`}
        >
          正文
        </button>

        {/* Headings: uniform 26x26 square */}
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={`w-[26px] h-[26px] rounded-md flex items-center justify-center transition text-xs shrink-0 whitespace-nowrap cursor-pointer ${
            editor.isActive('heading', { level: 1 })
              ? 'bg-zinc-200/90 dark:bg-zinc-700 text-zinc-900 dark:text-white font-medium'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-normal'
          }`}
        >
          H₁
        </button>

        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={`w-[26px] h-[26px] rounded-md flex items-center justify-center transition text-xs shrink-0 whitespace-nowrap cursor-pointer ${
            editor.isActive('heading', { level: 2 })
              ? 'bg-zinc-200/90 dark:bg-zinc-700 text-zinc-900 dark:text-white font-medium'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-normal'
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
              ? 'bg-zinc-200/90 dark:bg-zinc-700 text-zinc-900 dark:text-white'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
          }`}
          title="粗体 (Ctrl+B)"
        >
          B
        </button>

        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`w-[26px] h-[26px] rounded-md flex items-center justify-center italic text-xs shrink-0 whitespace-nowrap transition cursor-pointer ${
            editor.isActive('italic')
              ? 'bg-zinc-200/90 dark:bg-zinc-700 text-zinc-900 dark:text-white'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
          }`}
          title="斜体 (Ctrl+I)"
        >
          /
        </button>

        <button
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={`w-[26px] h-[26px] rounded-md flex items-center justify-center underline text-xs shrink-0 whitespace-nowrap transition cursor-pointer ${
            editor.isActive('underline')
              ? 'bg-zinc-200/90 dark:bg-zinc-700 text-zinc-900 dark:text-white'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
          }`}
          title="下划线 (Ctrl+U)"
        >
          U
        </button>

        <button
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={`w-[26px] h-[26px] rounded-md flex items-center justify-center line-through text-xs shrink-0 whitespace-nowrap transition cursor-pointer ${
            editor.isActive('strike')
              ? 'bg-zinc-200/90 dark:bg-zinc-700 text-zinc-900 dark:text-white'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
          }`}
          title="删除线"
        >
          ab
        </button>

        <button
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          className="relative w-[26px] h-[26px] rounded-md flex flex-col items-center justify-center text-xs shrink-0 whitespace-nowrap hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition cursor-pointer"
          title="文本荧光高亮"
        >
          <span className="leading-none text-[11px]">ab</span>
          <span className="w-3.5 h-[2px] bg-amber-400 rounded-full mt-0.5" />
        </button>

        <button
          onClick={handleInsertMath}
          className="w-[26px] h-[26px] rounded-md flex items-center justify-center italic font-serif text-xs font-semibold shrink-0 whitespace-nowrap hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition cursor-pointer"
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
              ? 'bg-zinc-200/90 dark:bg-zinc-700 text-zinc-900 dark:text-white'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
          }`}
          title="无序列表"
        >
          •≡
        </button>

        <button
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`w-[26px] h-[26px] rounded-md flex items-center justify-center text-xs shrink-0 whitespace-nowrap transition cursor-pointer ${
            editor.isActive('orderedList')
              ? 'bg-zinc-200/90 dark:bg-zinc-700 text-zinc-900 dark:text-white'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
          }`}
          title="编号列表"
        >
          1≡
        </button>

        <button
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={`w-[26px] h-[26px] rounded-md flex items-center justify-center text-xs font-serif shrink-0 whitespace-nowrap transition cursor-pointer ${
            editor.isActive('blockquote')
              ? 'bg-zinc-200/90 dark:bg-zinc-700 text-zinc-900 dark:text-white'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
          }`}
          title="引用"
        >
          ”
        </button>

        {/* Code block: slightly smaller 22x22 square with no space {} */}
        <button
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          className={`w-[22px] h-[22px] rounded flex items-center justify-center text-[11px] font-mono shrink-0 whitespace-nowrap transition cursor-pointer ${
            editor.isActive('codeBlock')
              ? 'bg-zinc-200/90 dark:bg-zinc-700 text-zinc-900 dark:text-white'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
          }`}
          title="代码块"
        >
          <span className="font-mono whitespace-nowrap leading-none font-medium">{'{}'}</span>
        </button>
      </div>

      {/* Editor Content Area: Title is directly below toolbar, strictly left-aligned at px-6 */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <input
          type="text"
          placeholder="无标题"
          value={title || ''}
          onChange={e => onUpdateTitle && onUpdateTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              editor?.commands.focus()
            }
          }}
          className="w-full text-[21px] font-bold bg-transparent outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-300 dark:placeholder:text-zinc-700 mb-3 tracking-tight"
        />
        <EditorContent editor={editor} />
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
    </div>
  )
})

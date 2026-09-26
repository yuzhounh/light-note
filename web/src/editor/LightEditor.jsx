import React, { useEffect, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Node, Mark, mergeAttributes } from '@tiptap/core'
import katex from 'katex'

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
          class: 'math-node'
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
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('span')
      dom.className = 'math-node'
      dom.setAttribute('data-latex', node.attrs.latex)
      dom.title = '点击编辑数学公式'
      
      try {
        katex.render(node.attrs.latex || '', dom, { throwOnError: false, displayMode: false })
      } catch (err) {
        dom.textContent = node.attrs.latex
      }

      dom.addEventListener('click', (e) => {
        e.stopPropagation()
        const newLatex = window.prompt('编辑 LaTeX 数学公式:', node.attrs.latex)
        if (newLatex !== null && typeof getPos === 'function') {
          editor.commands.command(({ tr }) => {
            tr.setNodeMarkup(getPos(), undefined, { latex: newLatex })
            return true
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

export function LightEditor({ content, onChange, isMobile = false }) {
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
    ],
    content: content || '',
    editorProps: {
      attributes: {
        class: 'prose dark:prose-invert max-w-none focus:outline-none min-h-[400px] text-zinc-900 dark:text-zinc-100 leading-relaxed text-[15px]',
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

  function handleInsertMath() {
    const input = window.prompt('输入 LaTeX 数学公式 (例如: E = mc^2 或 \\sqrt{x^2+y^2}):', 'E = mc^2')
    if (input) {
      editor.chain().focus().insertContent({
        type: 'mathNode',
        attrs: { latex: input }
      }).run()
    }
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900 overflow-hidden">
      {/* 1:1 Parity Desktop Toolbar */}
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs select-none overflow-x-auto">
        {/* Font Family Dropdown */}
        <select
          value={selectedFont}
          onChange={e => handleFontChange(e.target.value)}
          className="bg-transparent border border-zinc-200 dark:border-zinc-700 rounded px-1.5 py-1 text-xs text-zinc-800 dark:text-zinc-200 outline-none hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
        >
          {FONT_FAMILIES.map(f => (
            <option key={f.label} value={f.label}>{f.label}</option>
          ))}
        </select>

        {/* Font Size Dropdown */}
        <select
          value={selectedSize}
          onChange={e => handleSizeChange(e.target.value)}
          className="bg-transparent border border-zinc-200 dark:border-zinc-700 rounded px-1.5 py-1 text-xs text-zinc-800 dark:text-zinc-200 outline-none hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
        >
          {FONT_SIZES.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <div className="w-[1px] h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" />

        {/* Paragraph & Headings */}
        <button
          onClick={() => editor.chain().focus().setParagraph().run()}
          className={`px-2 py-1 rounded transition text-xs font-normal ${
            editor.isActive('paragraph') && !editor.isActive('heading')
              ? 'bg-zinc-200/80 dark:bg-zinc-700 text-zinc-900 dark:text-white'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
          }`}
        >
          正文
        </button>

        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={`px-2 py-1 rounded transition text-xs font-normal ${
            editor.isActive('heading', { level: 1 })
              ? 'bg-zinc-200/80 dark:bg-zinc-700 text-zinc-900 dark:text-white'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
          }`}
        >
          H₁
        </button>

        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={`px-2 py-1 rounded transition text-xs font-normal ${
            editor.isActive('heading', { level: 2 })
              ? 'bg-zinc-200/80 dark:bg-zinc-700 text-zinc-900 dark:text-white'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
          }`}
        >
          H₂
        </button>

        <div className="w-[1px] h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" />

        {/* B, I, U, Strike, Highlight, fx */}
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`w-6 h-6 rounded flex items-center justify-center font-bold text-xs transition ${
            editor.isActive('bold')
              ? 'bg-zinc-200/80 dark:bg-zinc-700 text-zinc-900 dark:text-white'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
          }`}
          title="粗体 (Ctrl+B)"
        >
          B
        </button>

        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`w-6 h-6 rounded flex items-center justify-center italic text-xs transition ${
            editor.isActive('italic')
              ? 'bg-zinc-200/80 dark:bg-zinc-700 text-zinc-900 dark:text-white'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
          }`}
          title="斜体 (Ctrl+I)"
        >
          /
        </button>

        <button
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={`w-6 h-6 rounded flex items-center justify-center underline text-xs transition ${
            editor.isActive('underline')
              ? 'bg-zinc-200/80 dark:bg-zinc-700 text-zinc-900 dark:text-white'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
          }`}
          title="下划线 (Ctrl+U)"
        >
          U
        </button>

        <button
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={`px-1.5 h-6 rounded flex items-center justify-center line-through text-xs transition ${
            editor.isActive('strike')
              ? 'bg-zinc-200/80 dark:bg-zinc-700 text-zinc-900 dark:text-white'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
          }`}
          title="删除线"
        >
          ab
        </button>

        <button
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          className="relative px-1.5 h-6 rounded flex flex-col items-center justify-center text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition"
          title="文本荧光高亮"
        >
          <span>ab</span>
          <span className="w-full h-[2.5px] bg-amber-400 rounded-full -mt-0.5" />
        </button>

        <button
          onClick={handleInsertMath}
          className="px-1.5 h-6 rounded flex items-center justify-center italic font-serif text-xs font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition"
          title="插入数学公式 (KaTeX)"
        >
          fx
        </button>

        <div className="w-[1px] h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" />

        {/* Lists, Quote, Code block */}
        <button
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`px-1.5 h-6 rounded flex items-center justify-center text-xs transition ${
            editor.isActive('bulletList')
              ? 'bg-zinc-200/80 dark:bg-zinc-700 text-zinc-900 dark:text-white'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
          }`}
          title="无序列表"
        >
          •≡
        </button>

        <button
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`px-1.5 h-6 rounded flex items-center justify-center text-xs transition ${
            editor.isActive('orderedList')
              ? 'bg-zinc-200/80 dark:bg-zinc-700 text-zinc-900 dark:text-white'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
          }`}
          title="编号列表"
        >
          1≡
        </button>

        <button
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={`px-1.5 h-6 rounded flex items-center justify-center text-xs font-serif transition ${
            editor.isActive('blockquote')
              ? 'bg-zinc-200/80 dark:bg-zinc-700 text-zinc-900 dark:text-white'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
          }`}
          title="引用"
        >
          ”
        </button>

        <button
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          className={`px-1.5 h-6 rounded flex items-center justify-center text-xs font-mono transition ${
            editor.isActive('codeBlock')
              ? 'bg-zinc-200/80 dark:bg-zinc-700 text-zinc-900 dark:text-white'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
          }`}
          title="代码块"
        >
          {'{ }'}
        </button>
      </div>

      {/* Editor Content Area */}
      <div className="flex-1 overflow-y-auto px-10 py-6">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

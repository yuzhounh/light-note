import React, { useEffect, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Node, mergeAttributes } from '@tiptap/core'
import katex from 'katex'
import { 
  Bold, Italic, Heading1, Heading2, List, ListOrdered, 
  Quote, Code, Sigma, Undo, Redo, Check
} from 'lucide-react'

// KaTeX Math Node Extension
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

export function LightEditor({ content, onChange, isMobile = false }) {
  const [mathPromptOpen, setMathPromptOpen] = useState(false)
  const [latexInput, setLatexInput] = useState('')

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      MathNode,
    ],
    content: content || '',
    editorProps: {
      attributes: {
        class: 'prose dark:prose-invert max-w-none focus:outline-none min-h-[300px] p-4 text-zinc-900 dark:text-zinc-100',
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

  // Synchronize content when active note changes
  useEffect(() => {
    if (editor && content !== undefined && editor.getHTML() !== content) {
      editor.commands.setContent(content || '', false)
    }
  }, [content, editor])

  if (!editor) return null

  function handleInsertMath() {
    const defaultFormula = 'E = mc^2'
    const input = window.prompt('输入 LaTeX 数学公式 (如 \\frac{a}{b} 或 E = mc^2):', defaultFormula)
    if (input) {
      editor.chain().focus().insertContent({
        type: 'mathNode',
        attrs: { latex: input }
      }).run()
    }
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900 overflow-hidden">
      {/* Format Toolbar */}
      <div className={`flex items-center gap-1 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/80 backdrop-blur overflow-x-auto ${
        isMobile ? 'text-xs' : 'text-sm'
      }`}>
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`p-1.5 rounded transition ${
            editor.isActive('bold') 
              ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 font-bold' 
              : 'hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
          }`}
          title="加粗 (Ctrl+B)"
        >
          <Bold size={16} />
        </button>

        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`p-1.5 rounded transition ${
            editor.isActive('italic') 
              ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400' 
              : 'hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
          }`}
          title="斜体 (Ctrl+I)"
        >
          <Italic size={16} />
        </button>

        <div className="w-[1px] h-4 bg-zinc-300 dark:bg-zinc-700 mx-1" />

        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={`p-1.5 rounded transition ${
            editor.isActive('heading', { level: 1 }) 
              ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400' 
              : 'hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
          }`}
          title="一级标题"
        >
          <Heading1 size={16} />
        </button>

        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={`p-1.5 rounded transition ${
            editor.isActive('heading', { level: 2 }) 
              ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400' 
              : 'hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
          }`}
          title="二级标题"
        >
          <Heading2 size={16} />
        </button>

        <div className="w-[1px] h-4 bg-zinc-300 dark:bg-zinc-700 mx-1" />

        <button
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`p-1.5 rounded transition ${
            editor.isActive('bulletList') 
              ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400' 
              : 'hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
          }`}
          title="无序列表"
        >
          <List size={16} />
        </button>

        <button
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`p-1.5 rounded transition ${
            editor.isActive('orderedList') 
              ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400' 
              : 'hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
          }`}
          title="有序列表"
        >
          <ListOrdered size={16} />
        </button>

        <button
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={`p-1.5 rounded transition ${
            editor.isActive('blockquote') 
              ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400' 
              : 'hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
          }`}
          title="引用块"
        >
          <Quote size={16} />
        </button>

        <button
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          className={`p-1.5 rounded transition ${
            editor.isActive('codeBlock') 
              ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400' 
              : 'hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
          }`}
          title="代码块"
        >
          <Code size={16} />
        </button>

        <div className="w-[1px] h-4 bg-zinc-300 dark:bg-zinc-700 mx-1" />

        {/* Math Formula Button */}
        <button
          onClick={handleInsertMath}
          className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 transition"
          title="插入数学公式 (KaTeX)"
        >
          <Sigma size={16} />
          <span className="text-xs font-semibold">公式</span>
        </button>

        <div className="flex-1" />

        <button
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-30 text-zinc-600 dark:text-zinc-400"
          title="撤销 (Ctrl+Z)"
        >
          <Undo size={16} />
        </button>

        <button
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-30 text-zinc-600 dark:text-zinc-400"
          title="重做 (Ctrl+Y)"
        >
          <Redo size={16} />
        </button>
      </div>

      {/* Editor Content Area */}
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  )
}

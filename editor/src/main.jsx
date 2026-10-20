import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorContent, useEditor, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { Node, Mark, Extension, InputRule, mergeAttributes } from '@tiptap/core'
import { Selection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { TableMap } from '@tiptap/pm/tables'
import { closeHistory } from '@tiptap/pm/history'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { createSizedTable, createTableSizing } from './tableSizing.js'
import { MarkdownGate } from './markdownGate.js'
import { insertSourceLine } from './pasteSource.js'
import Image from '@tiptap/extension-image'
import { Placeholder } from '@tiptap/extensions'
import katex from 'katex'
import { ATTACHMENT_HOST, createPasteProps, isLikelyMath } from './clipboard.js'
import { EditingKeys, currentTextStyle, selectionForMarginClick, scrollCaretIntoBodyView } from './editorBehavior.js'
import { applyNoteContent, clearDocument } from './noteDocument.js'
import { createCodeBlockSelection } from './codeBlockSelection.js'
import { imageLayout, imageSizingAttributes, initialImageSize, presetImageSize } from './imageSizing.js'
import './style.css'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const SizedTable = createSizedTable(Table, TableMap)
const TableSizing = createTableSizing({ Extension, Plugin, PluginKey, TextSelection, Decoration, DecorationSet, TableMap, closeHistory })

function post(type, payload = {}) {
  window.chrome?.webview?.postMessage({ type, payload })
}

function cssColorToHex(value) {
  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*1)?\)$/.exec(value || '')
  if (!match) return value
  return `#${match.slice(1, 4).map(part => Number(part).toString(16).padStart(2, '0')).join('')}`
}

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

const Link = Mark.create({
  name: 'link',
  priority: 1000,
  keepOnSplit: false,
  inclusive: false,
  addAttributes() {
    return {
      href: {
        default: null,
      },
      target: {
        default: '_blank',
      },
      rel: {
        default: 'noopener noreferrer',
      },
    }
  },
  parseHTML() {
    return [{ tag: 'a[href]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['a', mergeAttributes({ target: '_blank', rel: 'noopener noreferrer' }, HTMLAttributes), 0]
  },
})

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
        // The browser reports #fff2a8 as rgb(255, 242, 168); without converting it back, reloaded
        // highlights would no longer count as highlighted and could not be toggled off.
        parseHTML: element => cssColorToHex(element.style.backgroundColor) || null,
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
      toggleHighlight: () => ({ editor, commands }) => commands.setMark(this.name, {
        backgroundColor: editor.isActive(this.name, { backgroundColor: '#fff2a8' }) ? null : '#fff2a8',
      }),
    }
  },
})

function ResizableImageComponent({ editor, node, updateAttributes, selected, deleteNode }) {
  const [hovered, setHovered] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const containerRef = useRef(null)
  const imageRef = useRef(null)
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 })
  // Read-only notes (in the trash) keep only the double-click enlarged view.
  const showTools = editor.isEditable && (hovered || selected || isResizing)

  const resolvedSrc = node.attrs.src || (node.attrs.attachmentId ? `https://${ATTACHMENT_HOST}/${node.attrs.attachmentId}` : '')
  const layout = imageLayout(node.attrs, naturalSize.width, naturalSize.height, window.devicePixelRatio || 1)
  const readNaturalSize = () => {
    const image = imageRef.current
    if (image?.naturalWidth) setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight })
  }
  useEffect(readNaturalSize, [resolvedSrc])

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
      updateAttributes({ width: `${Math.round(finalWidth)}px`, baseWidth: layout.baseWidth, widthPreset: null, widthMode: 'manual' })
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const handleSetPresetWidth = (widthVal, e) => {
    e.preventDefault()
    e.stopPropagation()
    updateAttributes(presetImageSize(layout.baseWidth, widthVal))
  }

  const handleDoubleClick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (typeof window.__openImageLightbox === 'function') {
      window.__openImageLightbox(resolvedSrc)
    }
  }

  const currentWidth = layout.width

  return (
    <NodeViewWrapper
      as="span"
      ref={containerRef}
      className="resizable-image-wrapper"
      style={{ width: currentWidth, maxWidth: '100%', display: 'inline-block' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        className={`resizable-image-box ${selected ? 'is-selected' : ''}`}
        style={{ width: '100%', display: 'inline-block' }}
      >
        <img
          ref={imageRef}
          src={resolvedSrc}
          alt={node.attrs.alt || ''}
          data-attachment-id={node.attrs.attachmentId}
          style={{ width: '100%', maxWidth: '100%', display: 'block' }}
          className="resizable-image-img"
          onLoad={readNaturalSize}
          onDoubleClick={handleDoubleClick}
        />

        {/* Floating Quick Action Toolbar */}
        {showTools && (
          <span className="resizable-image-toolbar">
            <button
              type="button"
              onClick={(e) => handleSetPresetWidth('25%', e)}
              className={`preset-btn ${layout.widthPreset === '25%' ? 'active' : ''}`}
              title="25% 默认宽度"
            >
              25%
            </button>
            <button
              type="button"
              onClick={(e) => handleSetPresetWidth('50%', e)}
              className={`preset-btn ${layout.widthPreset === '50%' ? 'active' : ''}`}
              title="50% 默认宽度"
            >
              50%
            </button>
            <button
              type="button"
              onClick={(e) => handleSetPresetWidth('75%', e)}
              className={`preset-btn ${layout.widthPreset === '75%' ? 'active' : ''}`}
              title="75% 默认宽度"
            >
              75%
            </button>
            <button
              type="button"
              onClick={(e) => handleSetPresetWidth('100%', e)}
              className={`preset-btn ${layout.widthPreset === '100%' ? 'active' : ''}`}
              title="100% 默认宽度"
            >
              100%
            </button>
            <span className="toolbar-divider" />
            <button
              type="button"
              onClick={handleDoubleClick}
              className="action-btn"
              title="查看大图"
            >
              🔍
            </button>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteNode?.() }}
              className="action-btn delete-btn"
              title="删除图片"
            >
              🗑️
            </button>
          </span>
        )}

        {/* Bottom-right Drag Resize Handle */}
        {showTools && (
          <span
            onMouseDown={handleResizeStart}
            className="resizable-image-handle"
            title="拖拽调节大小"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M21 15v6h-6M21 21l-9-9" />
            </svg>
          </span>
        )}
      </span>
    </NodeViewWrapper>
  )
}

const LocalImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...imageSizingAttributes(),
      src: {
        default: null,
      },
      alt: {
        default: null,
      },
      attachmentId: {
        default: null,
        parseHTML: element => element.getAttribute('data-attachment-id'),
        renderHTML: attributes => attributes.attachmentId
          ? { 'data-attachment-id': attributes.attachmentId }
          : {},
      },
      width: {
        default: null,
        parseHTML: element => element.getAttribute('width') || element.style?.width || null,
        renderHTML: attributes => {
          if (!attributes.width) return {}
          return {
            width: attributes.width,
            style: `width: ${attributes.width}`,
          }
        },
      },
      height: {
        default: null,
        parseHTML: element => Number(element.getAttribute('height')) || null,
        renderHTML: attributes => attributes.height ? { height: attributes.height } : {},
      },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageComponent)
  },
}).configure({ allowBase64: true, inline: false })

const InlineMath = Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  priority: 1000,
  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: element => element.getAttribute('data-latex') || '',
        renderHTML: attributes => ({ 'data-latex': attributes.latex }),
      },
    }
  },
  parseHTML() {
    return [
      { tag: 'span[data-type="inline-math"]', priority: 1000 },
      { tag: 'math-inline', priority: 1000 },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'inline-math' })]
  },
  addCommands() {
    return {
      insertInlineMath: ({ latex, pos, to } = {}) => ({ commands, editor }) => {
        const from = pos ?? editor.state.selection.from
        return commands.insertContentAt(
          { from, to: to ?? from },
          { type: this.name, attrs: { latex: latex || '' } }
        )
      },
      updateInlineMath: ({ latex, pos }) => ({ editor, tr }) => {
        const targetPos = pos ?? editor.state.selection.from
        const node = editor.state.doc.nodeAt(targetPos)
        if (!node || node.type.name !== this.name) return false
        tr.setNodeMarkup(targetPos, this.type, { ...node.attrs, latex })
        return true
      },
      deleteInlineMath: ({ pos } = {}) => ({ editor, tr }) => {
        const targetPos = pos ?? editor.state.selection.from
        const node = editor.state.doc.nodeAt(targetPos)
        if (!node || node.type.name !== this.name) return false
        tr.delete(targetPos, targetPos + node.nodeSize)
        return true
      },
    }
  },
  addKeyboardShortcuts() {
    return {
      'Mod-m': () => {
        const { state } = this.editor
        const { from, to } = state.selection
        const selectedText = from < to ? state.doc.textBetween(from, to) : ''
        if (window.__openMathModal) {
          window.__openMathModal({
            isExisting: false,
            isBlock: false,
            latex: selectedText || '',
            pos: from,
            to,
          })
        }
        return true
      },
      'Mod-Shift-M': () => {
        const { state } = this.editor
        const { from, to } = state.selection
        const selectedText = from < to ? state.doc.textBetween(from, to) : ''
        if (window.__openMathModal) {
          window.__openMathModal({
            isExisting: false,
            isBlock: true,
            latex: selectedText || '',
            pos: from,
            to,
          })
        }
        return true
      },
    }
  },
  addInputRules() {
    return [
      new InputRule({
        find: /(?<!\$)\$([^\s$](?:[^$]*?[^\s$])?)\$(?!\$)/,
        handler: ({ state, range, match }) => {
          const latex = match[1]
          if (!isLikelyMath(latex)) return null
          const { tr } = state
          tr.replaceWith(range.from, range.to, this.type.create({ latex }))
        },
      }),
    ]
  },
  addNodeView() {
    const { editor } = this
    return ({ node, getPos }) => {
      // The click handler must see the formula as last edited, not as first rendered.
      let current = node
      const dom = document.createElement('span')
      dom.className = 'tiptap-mathematics-render'
      dom.setAttribute('data-type', 'inline-math')
      dom.setAttribute('data-latex', node.attrs.latex || '')
      dom.title = '数学公式 (点击编辑)'

      const render = latex => {
        dom.innerHTML = ''
        try {
          katex.render(latex || '', dom, { displayMode: false, throwOnError: false })
          dom.classList.remove('math-error')
        } catch {
          dom.textContent = `$${latex || ''}$`
          dom.classList.add('math-error')
        }
      }

      render(node.attrs.latex)

      const onClick = e => {
        e.preventDefault()
        e.stopPropagation()
        if (!editor.isEditable) return
        const pos = typeof getPos === 'function' ? getPos() : null
        if (pos != null && window.__openMathModal) {
          window.__openMathModal({
            isExisting: true,
            isBlock: false,
            latex: current.attrs.latex || '',
            pos,
          })
        }
      }
      dom.addEventListener('click', onClick)

      return {
        dom,
        update: updatedNode => {
          if (updatedNode.type !== node.type) return false
          current = updatedNode
          dom.setAttribute('data-latex', updatedNode.attrs.latex || '')
          render(updatedNode.attrs.latex)
          return true
        },
        destroy: () => {
          dom.removeEventListener('click', onClick)
        },
      }
    }
  },
})

const BlockMath = Node.create({
  name: 'blockMath',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  priority: 1000,
  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: element => element.getAttribute('data-latex') || '',
        renderHTML: attributes => ({ 'data-latex': attributes.latex }),
      },
    }
  },
  parseHTML() {
    return [
      { tag: 'div[data-type="block-math"]', priority: 1000 },
      { tag: 'math-block', priority: 1000 },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'block-math' })]
  },
  addCommands() {
    return {
      insertBlockMath: ({ latex, pos, to } = {}) => ({ commands, editor }) => {
        const from = pos ?? editor.state.selection.from
        return commands.insertContentAt(
          { from, to: to ?? from },
          { type: this.name, attrs: { latex: latex || '' } }
        )
      },
      updateBlockMath: ({ latex, pos }) => ({ editor, tr }) => {
        const targetPos = pos ?? editor.state.selection.from
        const node = editor.state.doc.nodeAt(targetPos)
        if (!node || node.type.name !== this.name) return false
        tr.setNodeMarkup(targetPos, this.type, { ...node.attrs, latex })
        return true
      },
      deleteBlockMath: ({ pos } = {}) => ({ editor, tr }) => {
        const targetPos = pos ?? editor.state.selection.from
        const node = editor.state.doc.nodeAt(targetPos)
        if (!node || node.type.name !== this.name) return false
        tr.delete(targetPos, targetPos + node.nodeSize)
        return true
      },
    }
  },
  addInputRules() {
    return [
      new InputRule({
        find: /^\$\$([^$]+)\$\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1]
          const { tr } = state
          const $from = state.doc.resolve(range.from)
          const replacementRange =
            $from.depth > 0 &&
            $from.parent.isTextblock &&
            range.from === $from.start() &&
            range.to === $from.end() &&
            $from.node(-1).canReplaceWith($from.index(-1), $from.indexAfter(-1), this.type)
              ? { from: $from.before(), to: $from.after() }
              : range
          tr.replaceWith(replacementRange.from, replacementRange.to, this.type.create({ latex }))
        },
      }),
    ]
  },
  addNodeView() {
    const { editor } = this
    return ({ node, getPos }) => {
      // The click handler must see the formula as last edited, not as first rendered.
      let current = node
      const dom = document.createElement('div')
      dom.className = 'tiptap-mathematics-render tiptap-mathematics-render--block'
      dom.setAttribute('data-type', 'block-math')
      dom.setAttribute('data-latex', node.attrs.latex || '')
      dom.title = '数学公式块 (点击编辑)'

      const render = latex => {
        dom.innerHTML = ''
        try {
          katex.render(latex || '', dom, { displayMode: true, throwOnError: false })
          dom.classList.remove('math-error')
        } catch {
          dom.textContent = `$$${latex || ''}$$`
          dom.classList.add('math-error')
        }
      }

      render(node.attrs.latex)

      const onClick = e => {
        e.preventDefault()
        e.stopPropagation()
        if (!editor.isEditable) return
        const pos = typeof getPos === 'function' ? getPos() : null
        if (pos != null && window.__openMathModal) {
          window.__openMathModal({
            isExisting: true,
            isBlock: true,
            latex: current.attrs.latex || '',
            pos,
          })
        }
      }
      dom.addEventListener('click', onClick)

      return {
        dom,
        update: updatedNode => {
          if (updatedNode.type !== node.type) return false
          current = updatedNode
          dom.setAttribute('data-latex', updatedNode.attrs.latex || '')
          render(updatedNode.attrs.latex)
          return true
        },
        destroy: () => {
          dom.removeEventListener('click', onClick)
        },
      }
    }
  },
})

function EditorApp() {
  const [, setStatus] = useState('编辑器桥接初始化中')
  const [mathModal, setMathModal] = useState(null)
  const [mathLatex, setMathLatex] = useState('')
  const [lightboxSrc, setLightboxSrc] = useState(null)
  const editorRef = useRef(null)
  const noteIdRef = useRef(null)
  const changeTimerRef = useRef(null)
  // Local edits count up revisionRef; reportedRevisionRef is the revision the host last received.
  const revisionRef = useRef(0)
  const reportedRevisionRef = useRef(0)
  const pendingImagesRef = useRef(new Map())
  const mathInputRef = useRef(null)
  const mathPreviewRef = useRef(null)

  const hasUnsentChanges = () => revisionRef.current !== reportedRevisionRef.current

  // Returns the edits the host has not received yet, or null. Content the host already has is
  // never sent again, so it cannot overwrite a newer version the host loaded from sync or history.
  const takeSnapshot = () => {
    const editor = editorRef.current
    const id = noteIdRef.current
    if (!editor || !id || !hasUnsentChanges()) return null
    reportedRevisionRef.current = revisionRef.current
    return {
      id,
      isDirty: true,
      json: editor.getJSON(),
      html: editor.getHTML(),
      text: editor.getText({ blockSeparator: '\n' }),
    }
  }

  const emitSnapshot = () => {
    const snapshot = takeSnapshot()
    if (snapshot) post('note.changed', snapshot)
  }

  const queueSnapshot = () => {
    clearTimeout(changeTimerRef.current)
    changeTimerRef.current = setTimeout(emitSnapshot, 180)
  }

  const emitState = editor => {
    const block = editor.isActive('heading', { level: 1 })
      ? 'h1'
      : editor.isActive('heading', { level: 2 })
        ? 'h2'
        : editor.isActive('blockquote')
          ? 'blockquote'
          : editor.isActive('codeBlock')
            ? 'pre'
            : 'p'
    post('editor.state', {
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      underline: editor.isActive('underline'),
      strike: editor.isActive('strike'),
      highlight: editor.isActive('textAppearance', { backgroundColor: '#fff2a8' }),
      inlineCode: editor.isActive('code'),
      bulletList: editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
      block,
      ...currentTextStyle(editor),
      canUndo: editor.can().chain().undo().run(),
      canRedo: editor.can().chain().redo().run(),
    })
  }

  const importImage = (file, position) => {
    const editor = editorRef.current
    const noteId = noteIdRef.current
    if (!editor || !noteId) return
    if (!ALLOWED_TYPES.has(file.type)) {
      setStatus('不支持此文件，仅可拖入 PNG、JPEG、WebP 或 GIF')
      return
    }
    if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
      setStatus('图片大小必须在 1 字节到 20 MB 之间')
      return
    }

    const requestId = crypto.randomUUID()
    pendingImagesRef.current.set(requestId, {
      noteId,
      position,
      name: file.name || '剪贴板图片',
    })
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      post('attachment.create', {
        requestId,
        noteId,
        fileName: file.name || `clipboard-${Date.now()}.png`,
        mimeType: file.type,
        dataBase64: result.includes(',') ? result.slice(result.indexOf(',') + 1) : result,
      })
      setStatus('正在保存图片…')
    }
    reader.onerror = () => {
      pendingImagesRef.current.delete(requestId)
      setStatus('无法读取图片')
    }
    reader.readAsDataURL(file)
  }

  const markdownAutoFormatRef = useRef(true)
  const recordPasteSourceRef = useRef(false)
  const pendingSourceRef = useRef(null)
  const [tableBar, setTableBar] = useState(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false, underline: false, codeBlock: { enableTabIndentation: true, tabSize: 4 } }),
      createCodeBlockSelection(Extension),
      MarkdownGate.configure({ isEnabled: () => markdownAutoFormatRef.current }),
      SizedTable, TableRow, TableHeader, TableCell, TableSizing,
      Underline,
      TextAppearance,
      Link,
      LocalImage,
      InlineMath,
      BlockMath,
      Placeholder.configure({ placeholder: '开始记录…' }),
      EditingKeys.configure({ onExitTop: () => post('editor.focusTitle') }),
    ],
    // Copied paragraphs paste into plain-text apps one per line, without blank lines between.
    coreExtensionOptions: { clipboardTextSerializer: { blockSeparator: '\n' } },
    content: '<p></p>',
    editable: false,
    immediatelyRender: true,
    editorProps: {
      handleScrollToSelection: scrollCaretIntoBodyView,
      attributes: {
        class: 'lightnote-content',
        spellcheck: 'true',
      },
      ...createPasteProps({
        onImages: (images, position) => images.forEach((image, index) => importImage(image, position + index)),
      }),
      handleDrop(view, event, _slice, moved) {
        if (moved) return false
        const files = [...(event.dataTransfer?.files || [])]
        if (!files.length) return false
        event.preventDefault()
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
          ?? view.state.selection.from
        files.forEach((file, index) => importImage(file, position + index))
        return true
      },
      handleClick(view, pos, event) {
        const link = event.target?.closest?.('a')
        if (link && link.href && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          window.open(link.href, '_blank')
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      revisionRef.current += 1
      queueSnapshot()
      emitState(currentEditor)
    },
    onSelectionUpdate: ({ editor: currentEditor }) => emitState(currentEditor),
    onTransaction: ({ transaction }) => {
      // Images are inserted once the host has saved them; keep their spot in step with typing.
      if (!transaction.docChanged) return
      for (const pending of pendingImagesRef.current.values()) {
        pending.position = transaction.mapping.map(pending.position, -1)
      }
    },
  })

  // Editor-wide listeners belong here, once per editor, rather than once per image node.
  useEffect(() => {
    if (!editor) return undefined
    const dom = editor.view.dom
    let lastCopiedText = ''
    const onCopy = () => {
      lastCopiedText = window.getSelection()?.toString() ?? ''
    }
    const onPaste = event => {
      if (!recordPasteSourceRef.current || !editor.isEditable) return
      const data = event.clipboardData
      const text = data?.getData('text/plain') ?? ''
      if (text && text === lastCopiedText) return
      if (!text.trim() && !data?.getData('text/html') && !data?.files?.length) return
      const requestId = crypto.randomUUID()
      const pending = { requestId, pos: null }
      pendingSourceRef.current = pending
      post('clipboard.source.request', { requestId })
      setTimeout(() => {
        if (pendingSourceRef.current === pending) pending.pos = editor.state.selection.to
      }, 0)
    }
    const onTransaction = ({ transaction }) => {
      const pending = pendingSourceRef.current
      if (pending?.pos != null && transaction.docChanged) pending.pos = transaction.mapping.map(pending.pos)
    }
    dom.addEventListener('paste', onPaste, true)
    dom.addEventListener('copy', onCopy)
    dom.addEventListener('cut', onCopy)
    editor.on('transaction', onTransaction)
    return () => {
      dom.removeEventListener('paste', onPaste, true)
      dom.removeEventListener('copy', onCopy)
      dom.removeEventListener('cut', onCopy)
      editor.off('transaction', onTransaction)
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return undefined
    const update = () => {
      if (!editor.isEditable || !editor.isActive('table')) {
        setTableBar(prev => (prev ? null : prev))
        return
      }
      const node = editor.view.domAtPos(editor.state.selection.from).node
      const element = (node.nodeType === 3 ? node.parentElement : node)?.closest?.('table')
      if (!element) {
        setTableBar(prev => (prev ? null : prev))
        return
      }
      const rect = element.getBoundingClientRect()
      const height = document.querySelector('.table-bar')?.offsetHeight || 36
      setTableBar({ left: Math.max(rect.left, 8), top: Math.max(rect.top - height - 6, 8) })
    }
    editor.on('selectionUpdate', update)
    editor.on('update', update)
    editor.on('focus', update)
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    update()
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('update', update)
      editor.off('focus', update)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [editor])

  const tableActions = [
    ['上方加行', 'addRowBefore'], ['下方加行', 'addRowAfter'], ['删除行', 'deleteRow'],
    ['左侧加列', 'addColumnBefore'], ['右侧加列', 'addColumnAfter'], ['删除列', 'deleteColumn'],
    ['表头', 'toggleHeaderRow'], ['删除表格', 'deleteTable'],
  ]

  const openMathModal = info => {
    setMathModal(info)
    setMathLatex(info?.latex || '')
    setTimeout(() => {
      mathInputRef.current?.focus()
      mathInputRef.current?.select()
    }, 50)
  }

  // Closing the formula dialog returns to the text. After an existing formula the caret goes just
  // past it: left selected, the formula would be replaced by the next typed character.
  const closeMathModal = caret => {
    setMathModal(null)
    if (!editor) return
    if (caret == null) {
      editor.commands.focus()
      return
    }
    editor.chain().focus().command(({ tr }) => {
      tr.setSelection(Selection.near(tr.doc.resolve(Math.min(caret, tr.doc.content.size))))
      return true
    }).run()
  }

  const cancelMathModal = () => {
    if (!mathModal) return
    closeMathModal(mathModal.isExisting ? mathModal.pos + 1 : null)
  }

  const applyMathModal = () => {
    if (!mathModal || !editor) return
    const latex = mathLatex.trim()
    if (!latex) {
      if (mathModal.isExisting) {
        deleteMathModal()
      } else {
        closeMathModal()
      }
      return
    }

    if (mathModal.isExisting) {
      if (mathModal.isBlock) {
        editor.commands.updateBlockMath({ latex, pos: mathModal.pos })
      } else {
        editor.commands.updateInlineMath({ latex, pos: mathModal.pos })
      }
      closeMathModal(mathModal.pos + 1)
      return
    }

    // The formula replaces the text it was made from.
    const range = { latex, pos: mathModal.pos, to: mathModal.to }
    if (mathModal.isBlock) {
      editor.commands.insertBlockMath(range)
    } else {
      editor.commands.insertInlineMath(range)
    }
    closeMathModal()
  }

  const deleteMathModal = () => {
    if (!mathModal || !editor) return
    if (mathModal.isExisting) {
      if (mathModal.isBlock) {
        editor.commands.deleteBlockMath({ pos: mathModal.pos })
      } else {
        editor.commands.deleteInlineMath({ pos: mathModal.pos })
      }
    }
    closeMathModal(mathModal.pos)
  }

  useEffect(() => {
    window.__openMathModal = openMathModal
    return () => {
      delete window.__openMathModal
    }
  }, [])

  useEffect(() => {
    if (mathModal && mathPreviewRef.current) {
      try {
        katex.render(mathLatex || '', mathPreviewRef.current, {
          displayMode: mathModal.isBlock,
          throwOnError: false,
        })
      } catch {
        mathPreviewRef.current.textContent = mathLatex || ''
      }
    }
  }, [mathModal, mathLatex])

  useEffect(() => {
    editorRef.current = editor
    if (!editor) return undefined

    const runCommand = (command, value) => {
      const commands = {
        paragraph: () => editor.chain().focus().setParagraph().run(),
        heading1: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
        heading2: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        bold: () => editor.chain().focus().toggleBold().run(),
        italic: () => editor.chain().focus().toggleItalic().run(),
        underline: () => editor.chain().focus().toggleUnderline().run(),
        strike: () => editor.chain().focus().toggleStrike().run(),
        highlight: () => editor.chain().focus().toggleHighlight().run(),
        inlineCode: () => editor.chain().focus().toggleCode().run(),
        fontFamily: () => editor.chain().focus().setFontFamily(value).run(),
        fontSize: () => editor.chain().focus().setFontSize(`${value}px`).run(),
        bulletList: () => editor.chain().focus().toggleBulletList().run(),
        orderedList: () => editor.chain().focus().toggleOrderedList().run(),
        blockquote: () => editor.chain().focus().toggleBlockquote().run(),
        codeBlock: () => editor.chain().focus().toggleCodeBlock().run(),
        insertTable: () => {
          if (Number.isInteger(value?.rows) && value.rows >= 1 && value.rows <= 100 &&
              Number.isInteger(value?.cols) && value.cols >= 1 && value.cols <= 30) {
            editor.chain().focus().insertTable({ rows: value.rows, cols: value.cols, withHeaderRow: true }).run()
          }
        },
        inlineMath: () => {
          const { state } = editor
          const { from, to } = state.selection
          const selectedText = from < to ? state.doc.textBetween(from, to) : ''
          openMathModal({
            isExisting: false,
            isBlock: false,
            latex: selectedText || '',
            pos: from,
            to,
          })
        },
        blockMath: () => {
          const { state } = editor
          const { from, to } = state.selection
          const selectedText = from < to ? state.doc.textBetween(from, to) : ''
          openMathModal({
            isExisting: false,
            isBlock: true,
            latex: selectedText || '',
            pos: from,
            to,
          })
        },
        undo: () => editor.chain().focus().undo().run(),
        redo: () => editor.chain().focus().redo().run(),
        insertTimestamp: () => {
          const d = new Date()
          const pad = n => String(n).padStart(2, '0')
          const timestamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
          editor.chain().focus().insertContent(timestamp).run()
          editor.commands.splitBlock()
          editor.commands.splitBlock()
        },
        focus: () => {
          if (value === 'start' || value === 'end' || value === 'all') {
            editor.commands.focus(value)
          } else {
            editor.commands.focus()
          }
        },
      }
      if (command !== 'focus' && !editor.isEditable) return
      commands[command]?.()
      emitState(editor)
    }

    const closeOverlays = () => {
      setMathModal(null)
      setLightboxSrc(null)
    }

    const onMessage = event => {
      const message = event.data
      if (message?.type === 'editor.clear') {
        closeOverlays()
        clearTimeout(changeTimerRef.current)
        reportedRevisionRef.current = revisionRef.current
        noteIdRef.current = null
        pendingSourceRef.current = null
        setTableBar(null)
        pendingImagesRef.current.clear()
        clearDocument(editor)
        editor.setEditable(false, false)
        setStatus('请选择或新建一篇笔记')
        return
      }
      if (message?.type === 'theme.changed') {
        const isDark = Boolean(message.payload?.isDark)
        document.documentElement.classList.toggle('dark', isDark)
        document.documentElement.classList.toggle('light', !isDark)
        document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
        return
      }
      if (message?.type === 'editor.settings') {
        markdownAutoFormatRef.current = message.payload?.markdownAutoFormat !== false
        recordPasteSourceRef.current = message.payload?.recordPasteSource === true
        return
      }
      if (message?.type === 'clipboard.source') {
        const pending = pendingSourceRef.current
        if (!pending || pending.requestId !== message.payload?.requestId) return
        pendingSourceRef.current = null
        if (!message.payload?.label || !editor.isEditable) return
        insertSourceLine(editor, pending.pos ?? editor.state.selection.to, message.payload)
        emitState(editor)
        return
      }
      if (message?.type === 'editor.command') {
        runCommand(message.payload?.command, message.payload?.value)
        return
      }
      if (message?.type === 'attachment.created') {
        const pending = pendingImagesRef.current.get(message.payload?.requestId)
        if (!pending || pending.noteId !== noteIdRef.current) return
        pendingImagesRef.current.delete(message.payload.requestId)
        const position = Math.min(pending.position, editor.state.doc.content.size)
        // The caret moves past the image only if it is still where the image was pasted;
        // otherwise the user has typed on, and the caret and the view stay where they are.
        const { selection } = editor.state
        const followCaret = selection.empty && selection.from === position
        const insert = editor.chain().insertContentAt(position, {
          type: 'image',
          attrs: {
            src: message.payload.url,
            alt: pending.name,
            attachmentId: message.payload.id,
            ...initialImageSize(message.payload.width, message.payload.height, window.devicePixelRatio || 1),
          },
        }, { updateSelection: followCaret })
        ;(followCaret ? insert.focus() : insert).run()
        setStatus('图片已保存到本地')
        return
      }
      if (message?.type === 'attachment.error') {
        pendingImagesRef.current.delete(message.payload?.requestId)
        setStatus(message.payload?.message || '图片保存失败')
        return
      }
      if (message?.type !== 'note.load') return

      // The host re-sends the open note after every save-triggered sync and window activation.
      const { id, html, title, readOnly } = message.payload
      const sameNote = id === noteIdRef.current
      if (!sameNote) {
        // Edits typed after the host's last snapshot still belong to the note being left.
        emitSnapshot()
        closeOverlays()
        pendingSourceRef.current = null
        setTableBar(null)
      }
      // Notes in the trash are read-only: the host discards edits to them. emitUpdate=false keeps
      // Tiptap from reporting this as an edit.
      editor.setEditable(!readOnly, false)
      const result = applyNoteContent(editor, html, { sameNote, hasUnsentChanges: hasUnsentChanges() })
      if (result === 'loaded' || result === 'replaced') {
        clearTimeout(changeTimerRef.current)
        reportedRevisionRef.current = revisionRef.current
      }
      if (!sameNote) {
        noteIdRef.current = id
        pendingImagesRef.current.clear()
      }
      setStatus(`已载入：${title}`)
      post('note.loaded', { id })
      if (result === 'loaded') editor.commands.focus('start')
      emitState(editor)
    }

    // Focus arriving by keyboard (Tab from the title, Alt+Tab back) lands on the page itself; hand it
    // to the editor without moving the caret or scrolling. A click focuses the editor by itself and
    // must keep the caret where it was clicked, so this waits until the click has been handled.
    const onWindowFocus = () => {
      setTimeout(() => {
        if (noteIdRef.current && editor.isEditable && document.activeElement === document.body) {
          editor.view.focus()
        }
      })
    }
    window.addEventListener('focus', onWindowFocus)

    // Clicks beside or below the text put the caret at the nearest text instead of jumping to the end.
    const onBodyClick = e => {
      if (!noteIdRef.current || !editor.isEditable || e.button !== 0) return
      // Keep a selection made by dragging.
      if (!window.getSelection()?.isCollapsed) return
      const { view } = editor
      const inMargin = e.target === document.body || e.target.id === 'root' || e.target === view.dom
      // The page scrollbar sits to the right of the body's client area.
      if (!inMargin || e.clientX >= document.body.clientWidth) return
      const selection = selectionForMarginClick(view, e)
      if (!selection) return
      view.dispatch(view.state.tr.setSelection(selection))
      view.focus()
    }
    document.addEventListener('click', onBodyClick)

    window.__openImageLightbox = (src) => setLightboxSrc(src)

    window.lightNoteEditor = {
      getSnapshot: takeSnapshot,
      focus: position => {
        if (position === 'start' || position === 'end' || position === 'all') {
          editor.commands.focus(position)
        } else {
          editor.commands.focus()
        }
      },
    }
    window.chrome?.webview?.addEventListener('message', onMessage)
    post('editor.ready')
    return () => {
      clearTimeout(changeTimerRef.current)
      window.removeEventListener('focus', onWindowFocus)
      document.removeEventListener('click', onBodyClick)
      window.chrome?.webview?.removeEventListener('message', onMessage)
      delete window.__openImageLightbox
      delete window.lightNoteEditor
    }
  }, [editor])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && lightboxSrc) {
        setLightboxSrc(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [lightboxSrc])

  return (
    <>
      <EditorContent editor={editor} className="tiptap-editor-wrapper" />
      {tableBar && (
        <div
          className="table-bar"
          style={{ left: tableBar.left, top: tableBar.top }}
          onMouseDown={event => event.preventDefault()}
        >
          <button type="button" onClick={() => editor.chain().focus().equalizeTableColumns().run()}>平均分配</button>
          <button type="button" onClick={() => editor.chain().focus().resetTableWidth().run()}>重置表宽</button>
          <button type="button" onClick={() => editor.chain().focus().standardizeTableColumns().run()}>统一列宽</button>
          {tableActions.map(([label, command]) => (
            <button
              key={command}
              type="button"
              className={command === 'deleteTable' ? 'table-bar-danger' : undefined}
              onClick={() => {
                editor.chain().focus()[command]().run()
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {mathModal && (
        <div className="math-modal-overlay" onClick={cancelMathModal}>
          <div className="math-modal-card" onClick={e => e.stopPropagation()}>
            <div className="math-modal-header">
              <span className="math-modal-title">
                {mathModal.isBlock ? '公式块 (LaTeX)' : '行内公式 (LaTeX)'}
              </span>
              <button
                className="math-modal-close"
                onClick={cancelMathModal}
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
            <div className="math-modal-body">
              <label className="math-modal-label">LaTeX 代码：</label>
              <textarea
                ref={mathInputRef}
                className="math-modal-input"
                value={mathLatex}
                onChange={e => setMathLatex(e.target.value)}
                onKeyDown={e => {
                  // Enter that confirms an input-method candidate is not a submit.
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return
                  if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey)) {
                    e.preventDefault()
                    applyMathModal()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    cancelMathModal()
                  }
                }}
                placeholder="例如：\rightarrow, E = mc^2, \sum_{i=1}^n x_i"
                rows={3}
              />
              <div className="math-modal-label">公式预览：</div>
              <div className="math-modal-preview">
                {mathLatex ? (
                  <div ref={mathPreviewRef} />
                ) : (
                  <span className="math-modal-preview-placeholder">（输入 LaTeX 代码查看预览）</span>
                )}
              </div>
            </div>
            <div className="math-modal-footer">
              {mathModal.isExisting && (
                <button className="math-modal-btn math-modal-btn-danger" onClick={deleteMathModal}>
                  删除公式
                </button>
              )}
              <button className="math-modal-btn" onClick={cancelMathModal}>
                取消
              </button>
              <button className="math-modal-btn math-modal-btn-primary" onClick={applyMathModal}>
                确定
              </button>
            </div>
          </div>
        </div>
      )}
      {lightboxSrc && (
        <div
          className="image-lightbox-overlay"
          onClick={() => setLightboxSrc(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxSrc(null)}
            className="image-lightbox-close"
            title="关闭 (Esc)"
          >
            ✕
          </button>
          <img
            src={lightboxSrc}
            alt="大图预览"
            className="image-lightbox-img"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}

const mq = window.matchMedia('(prefers-color-scheme: dark)')
const applyThemeFromMedia = isDark => {
  document.documentElement.classList.toggle('dark', isDark)
  document.documentElement.classList.toggle('light', !isDark)
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
}
applyThemeFromMedia(mq.matches)
try {
  mq.addEventListener('change', e => applyThemeFromMedia(e.matches))
} catch {
  mq.addListener?.(e => applyThemeFromMedia(e.matches))
}

createRoot(document.getElementById('root')).render(<EditorApp />)

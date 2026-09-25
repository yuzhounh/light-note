import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorContent, useEditor } from '@tiptap/react'
import { Node, Mark, InputRule, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import katex from 'katex'
import MarkdownIt from 'markdown-it'
import './style.css'

const ATTACHMENT_HOST = 'lightnote.attachments'
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

const mdParser = new MarkdownIt({ html: true, breaks: false })

function post(type, payload = {}) {
  window.chrome?.webview?.postMessage({ type, payload })
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function isLikelyMath(str) {
  if (!str || typeof str !== 'string') return false
  const trimmed = str.trim()
  if (!trimmed) return false
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return false
  if (/\\(?:[a-zA-Z]+|[^\s])/.test(trimmed)) return true
  if (/[\\^_{}]/.test(trimmed)) return true
  if (/[=<>+\-*/]/.test(trimmed) && !/^\s*[\u4e00-\u9fa5a-zA-Z]+\s+[\u4e00-\u9fa5a-zA-Z]+\s*$/.test(trimmed)) return true
  if (/^[a-zA-Z]$/.test(trimmed)) return true
  if (/^[a-zA-Z]\([a-zA-Z0-9, ]+\)$/.test(trimmed)) return true
  return false
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
      toggleHighlight: () => ({ editor, commands }) => commands.setMark(this.name, {
        backgroundColor: editor.isActive(this.name, { backgroundColor: '#fff2a8' }) ? null : '#fff2a8',
      }),
    }
  },
})

const LocalImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      attachmentId: {
        default: null,
        parseHTML: element => element.getAttribute('data-attachment-id'),
        renderHTML: attributes => attributes.attachmentId
          ? { 'data-attachment-id': attributes.attachmentId }
          : {},
      },
      width: {
        default: null,
        parseHTML: element => Number(element.getAttribute('width')) || null,
        renderHTML: attributes => attributes.width ? { width: attributes.width } : {},
      },
      height: {
        default: null,
        parseHTML: element => Number(element.getAttribute('height')) || null,
        renderHTML: attributes => attributes.height ? { height: attributes.height } : {},
      },
    }
  },
}).configure({ allowBase64: false, inline: false })

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
      insertInlineMath: ({ latex, pos } = {}) => ({ commands, editor }) => {
        return commands.insertContentAt(
          pos ?? editor.state.selection.from,
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
    return ({ node, getPos }) => {
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
        const pos = typeof getPos === 'function' ? getPos() : null
        if (pos != null && window.__openMathModal) {
          window.__openMathModal({
            isExisting: true,
            isBlock: false,
            latex: node.attrs.latex || '',
            pos,
          })
        }
      }
      dom.addEventListener('click', onClick)

      return {
        dom,
        update: updatedNode => {
          if (updatedNode.type !== node.type) return false
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
      insertBlockMath: ({ latex, pos } = {}) => ({ commands, editor }) => {
        return commands.insertContentAt(
          pos ?? editor.state.selection.from,
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
    return ({ node, getPos }) => {
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
        const pos = typeof getPos === 'function' ? getPos() : null
        if (pos != null && window.__openMathModal) {
          window.__openMathModal({
            isExisting: true,
            isBlock: true,
            latex: node.attrs.latex || '',
            pos,
          })
        }
      }
      dom.addEventListener('click', onClick)

      return {
        dom,
        update: updatedNode => {
          if (updatedNode.type !== node.type) return false
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

function extractExistingKatex(root) {
  for (const el of [...root.querySelectorAll('.katex')]) {
    const isBlock = Boolean(el.closest('.katex-display'))
    const annotation = el.querySelector('annotation[encoding="application/x-tex"]')
    const latex = annotation?.textContent?.trim()
    if (latex) {
      const target = isBlock ? el.closest('.katex-display') || el : el
      const replacement = document.createElement(isBlock ? 'div' : 'span')
      replacement.setAttribute('data-type', isBlock ? 'block-math' : 'inline-math')
      replacement.setAttribute('data-latex', latex)
      target.parentNode?.replaceChild(replacement, target)
    }
  }
}

function convertMathInTextNodes(root) {
  for (const span of [...root.querySelectorAll('span')]) {
    if (span.hasAttribute('data-type') || span.classList.contains('katex')) continue
    const text = span.textContent?.trim() || ''
    const match = text.match(/^\$([^$]+)\$$/)
    if (match && isLikelyMath(match[1])) {
      const inline = document.createElement('span')
      inline.setAttribute('data-type', 'inline-math')
      inline.setAttribute('data-latex', match[1].trim())
      span.parentNode?.replaceChild(inline, span)
    }
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  const textNodes = []
  let currentNode
  while ((currentNode = walker.nextNode())) {
    const parentTag = currentNode.parentElement?.tagName?.toLowerCase()
    if (
      parentTag === 'script' ||
      parentTag === 'style' ||
      currentNode.parentElement?.closest('[data-type="inline-math"], [data-type="block-math"], .katex')
    ) {
      continue
    }
    if (currentNode.nodeValue && currentNode.nodeValue.includes('$')) {
      textNodes.push(currentNode)
    }
  }

  for (const node of textNodes) {
    const text = node.nodeValue || ''
    const mathPattern = /(\$\$[\s\S]+?\$\$|(?<!\$)\$[^\s$](?:[^$]*?[^\s$])?\$(?!\$))/g
    if (!mathPattern.test(text)) continue

    mathPattern.lastIndex = 0
    const fragment = document.createDocumentFragment()
    let lastIndex = 0
    let match

    while ((match = mathPattern.exec(text)) !== null) {
      const matchIndex = match.index
      if (matchIndex > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, matchIndex)))
      }
      const raw = match[0]
      if (raw.startsWith('$$') && raw.endsWith('$$')) {
        const latex = raw.slice(2, -2).trim()
        const block = document.createElement('div')
        block.setAttribute('data-type', 'block-math')
        block.setAttribute('data-latex', latex)
        fragment.appendChild(block)
      } else {
        const latex = raw.slice(1, -1).trim()
        if (isLikelyMath(latex)) {
          const inline = document.createElement('span')
          inline.setAttribute('data-type', 'inline-math')
          inline.setAttribute('data-latex', latex)
          fragment.appendChild(inline)
        } else {
          fragment.appendChild(document.createTextNode(raw))
        }
      }
      lastIndex = matchIndex + raw.length
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)))
    }

    node.parentNode?.replaceChild(fragment, node)
  }
}

function removeRedundantEmptyElements(root) {
  let changed = true
  while (changed) {
    changed = false
    for (const el of [...root.querySelectorAll('p, div')]) {
      if (el.querySelector('img, [data-type="inline-math"], [data-type="block-math"], hr, pre, table')) {
        continue
      }
      const text = el.textContent?.replace(/[\s\u00a0\u200b]+/g, '') || ''
      if (text.length === 0) {
        el.remove()
        changed = true
      }
    }
  }

  for (const li of [...root.querySelectorAll('li')]) {
    if (
      !li.querySelector('img, [data-type="inline-math"], [data-type="block-math"]') &&
      (li.textContent?.replace(/[\s\u00a0\u200b]+/g, '') || '').length === 0
    ) {
      li.remove()
      continue
    }
    const paragraphs = li.querySelectorAll(':scope > p')
    if (paragraphs.length === 1 && li.children.length === 1) {
      const p = paragraphs[0]
      while (p.firstChild) {
        li.insertBefore(p.firstChild, p)
      }
      p.remove()
    }
  }

  for (const br of [...root.querySelectorAll('br')]) {
    let next = br.nextSibling
    while (next && next.nodeType === 3 && !next.nodeValue.trim()) {
      next = next.nextSibling
    }
    if (next && next.nodeName === 'BR') {
      br.remove()
    }
  }
}

function cleanAndConvertHtml(html) {
  const doc = new DOMParser().parseFromString(html || '<p></p>', 'text/html')
  extractExistingKatex(doc.body)
  convertMathInTextNodes(doc.body)
  removeRedundantEmptyElements(doc.body)

  for (const image of doc.querySelectorAll('img')) {
    try {
      const url = new URL(image.getAttribute('src') || '')
      if (url.protocol !== 'https:' || url.hostname !== ATTACHMENT_HOST) image.remove()
    } catch {
      image.remove()
    }
  }

  return doc.body.innerHTML || '<p></p>'
}

function hasMarkdownSyntax(text) {
  if (!text) return false
  return (
    /(?:^|\n)#{1,6}\s+/.test(text) ||
    /(?:^|\n)\s*(?:[-*+]|\d+\.)\s+/.test(text) ||
    /\*\*[^*]+\*\*/.test(text) ||
    /\*[^*]+\*/.test(text) ||
    /`[^`]+`/.test(text) ||
    /```[\s\S]*?```/.test(text) ||
    /(?:^|\n)>\s+/.test(text) ||
    /\$\$[\s\S]+?\$\$/.test(text) ||
    /(?<!\$)\$[^\s$](?:[^$]*?[^\s$])?\$(?!\$)/.test(text) ||
    /\[[^\]]+\]\([^)]+\)/.test(text) ||
    /!\[[^\]]*\]\([^)]+\)/.test(text) ||
    /(?:^|\n)(?:---|\*\*\*)\s*(?:\n|$)/.test(text)
  )
}

function markdownToCleanHtml(raw) {
  let md = (raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  md = md.replace(/\n{3,}/g, '\n\n')

  const listItemPattern = /(^|\n)(\s*(?:[-*+]|\d+\.)\s+[^\n]+)\n\s*\n(?=\s*(?:[-*+]|\d+\.)\s+)/g
  let prev
  do {
    prev = md
    md = md.replace(listItemPattern, '$1$2\n')
  } while (md !== prev)

  md = md.replace(/\$\$([\s\S]+?)\$\$/g, (_, latex) => {
    return `\n<div data-type="block-math" data-latex="${escapeHtml(latex.trim())}"></div>\n`
  })

  md = md.replace(/(?<!\$)\$([^\s$](?:[^$]*?[^\s$])?)\$(?!\$)/g, (fullMatch, latex) => {
    if (isLikelyMath(latex)) {
      return `<span data-type="inline-math" data-latex="${escapeHtml(latex.trim())}"></span>`
    }
    return fullMatch
  })

  const rawHtml = mdParser.render(md.trim())
  return cleanAndConvertHtml(rawHtml)
}

function EditorApp() {
  const [, setStatus] = useState('编辑器桥接初始化中')
  const [mathModal, setMathModal] = useState(null)
  const [mathLatex, setMathLatex] = useState('')
  const editorRef = useRef(null)
  const noteIdRef = useRef(null)
  const changeTimerRef = useRef(null)
  const pendingImagesRef = useRef(new Map())
  const mathInputRef = useRef(null)
  const mathPreviewRef = useRef(null)

  const emitSnapshot = () => {
    const editor = editorRef.current
    const id = noteIdRef.current
    if (!editor || !id) return
    post('note.changed', {
      id,
      json: editor.getJSON(),
      html: editor.getHTML(),
      text: editor.getText({ blockSeparator: '\n' }),
    })
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

  const editor = useEditor({
    extensions: [StarterKit, Underline, TextAppearance, LocalImage, InlineMath, BlockMath],
    content: '<p></p>',
    editable: false,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        class: 'lightnote-content',
        spellcheck: 'true',
      },
      handlePaste(view, event) {
        const images = [...(event.clipboardData?.items || [])]
          .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
          .map(item => item.getAsFile())
          .filter(Boolean)
        if (images.length) {
          event.preventDefault()
          images.forEach((image, index) => importImage(image, view.state.selection.from + index))
          return true
        }

        const clipboardHtml = event.clipboardData?.getData('text/html')
        const clipboardText = event.clipboardData?.getData('text/plain')

        if (clipboardText && (!clipboardHtml || hasMarkdownSyntax(clipboardText))) {
          if (hasMarkdownSyntax(clipboardText)) {
            event.preventDefault()
            const html = markdownToCleanHtml(clipboardText)
            editor?.commands?.insertContent(html)
            return true
          }
        }

        if (clipboardHtml) {
          event.preventDefault()
          const cleaned = cleanAndConvertHtml(clipboardHtml)
          editor?.commands?.insertContent(cleaned)
          return true
        }

        if (clipboardText) {
          let text = clipboardText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
          text = text.replace(/\n{3,}/g, '\n\n').trim()
          if (text.includes('$')) {
            event.preventDefault()
            const html = markdownToCleanHtml(text)
            editor?.commands?.insertContent(html)
            return true
          }
        }

        return false
      },
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
    },
    onUpdate: ({ editor: currentEditor }) => {
      queueSnapshot()
      emitState(currentEditor)
    },
    onSelectionUpdate: ({ editor: currentEditor }) => emitState(currentEditor),
  })

  const openMathModal = info => {
    setMathModal(info)
    setMathLatex(info?.latex || '')
    setTimeout(() => {
      mathInputRef.current?.focus()
      mathInputRef.current?.select()
    }, 50)
  }

  const applyMathModal = () => {
    if (!mathModal || !editor) return
    const latex = mathLatex.trim()
    if (!latex) {
      if (mathModal.isExisting) {
        deleteMathModal()
      } else {
        setMathModal(null)
      }
      return
    }

    if (mathModal.isExisting) {
      if (mathModal.isBlock) {
        editor.commands.updateBlockMath({ latex, pos: mathModal.pos })
      } else {
        editor.commands.updateInlineMath({ latex, pos: mathModal.pos })
      }
    } else {
      if (mathModal.isBlock) {
        editor.commands.insertBlockMath({ latex, pos: mathModal.pos })
      } else {
        editor.commands.insertInlineMath({ latex, pos: mathModal.pos })
      }
    }
    setMathModal(null)
    editor.commands.focus()
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
    setMathModal(null)
    editor.commands.focus()
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

    const getSnapshot = () => {
      const id = noteIdRef.current
      if (!id) return null
      return {
        id,
        json: editor.getJSON(),
        html: editor.getHTML(),
        text: editor.getText({ blockSeparator: '\n' }),
      }
    }

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
        inlineMath: () => {
          const { state } = editor
          const { from, to } = state.selection
          const selectedText = from < to ? state.doc.textBetween(from, to) : ''
          openMathModal({
            isExisting: false,
            isBlock: false,
            latex: selectedText || '',
            pos: from,
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
          })
        },
        undo: () => editor.chain().focus().undo().run(),
        redo: () => editor.chain().focus().redo().run(),
        focus: () => {
          if (value === 'start' || value === 'end' || value === 'all') {
            editor.commands.focus(value)
          } else {
            editor.commands.focus()
          }
        },
      }
      commands[command]?.()
      emitState(editor)
    }

    const onMessage = event => {
      const message = event.data
      if (message?.type === 'editor.clear') {
        clearTimeout(changeTimerRef.current)
        noteIdRef.current = null
        pendingImagesRef.current.clear()
        editor.commands.setContent('<p></p>', { emitUpdate: false })
        editor.setEditable(false)
        setStatus('请选择或新建一篇笔记')
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
        editor.chain().focus().insertContentAt(position, {
          type: 'image',
          attrs: {
            src: message.payload.url,
            alt: pending.name,
            attachmentId: message.payload.id,
            width: message.payload.width,
            height: message.payload.height,
          },
        }).run()
        setStatus('图片已保存到本地')
        return
      }
      if (message?.type === 'attachment.error') {
        pendingImagesRef.current.delete(message.payload?.requestId)
        setStatus(message.payload?.message || '图片保存失败')
        return
      }
      if (message?.type !== 'note.load') return

      clearTimeout(changeTimerRef.current)
      noteIdRef.current = message.payload.id
      pendingImagesRef.current.clear()
      const processedHtml = cleanAndConvertHtml(message.payload.html)
      editor.commands.setContent(processedHtml, { emitUpdate: false })
      editor.setEditable(true)
      setStatus(`已载入：${message.payload.title}`)
      post('note.loaded', { id: noteIdRef.current })
      editor.commands.focus('start')
      emitState(editor)
    }

    const onWindowFocus = () => {
      if (editor && !editor.isFocused && noteIdRef.current) {
        editor.commands.focus()
      }
    }
    window.addEventListener('focus', onWindowFocus)

    window.lightNoteEditor = {
      getSnapshot,
      focus: (position = 'start') => {
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
      window.chrome?.webview?.removeEventListener('message', onMessage)
      delete window.lightNoteEditor
    }
  }, [editor])

  return (
    <>
      <EditorContent editor={editor} />
      {mathModal && (
        <div className="math-modal-overlay" onClick={() => setMathModal(null)}>
          <div className="math-modal-card" onClick={e => e.stopPropagation()}>
            <div className="math-modal-header">
              <span className="math-modal-title">
                {mathModal.isBlock ? '公式块 (LaTeX)' : '行内公式 (LaTeX)'}
              </span>
              <button
                className="math-modal-close"
                onClick={() => setMathModal(null)}
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
                  if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey)) {
                    e.preventDefault()
                    applyMathModal()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setMathModal(null)
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
              <button className="math-modal-btn" onClick={() => setMathModal(null)}>
                取消
              </button>
              <button className="math-modal-btn math-modal-btn-primary" onClick={applyMathModal}>
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

createRoot(document.getElementById('root')).render(<EditorApp />)

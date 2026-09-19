import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorContent, useEditor } from '@tiptap/react'
import { Mark, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import './style.css'

const ATTACHMENT_HOST = 'lightnote.attachments'
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

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
  parseHTML: () => [{ tag: 'span' }],
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

function post(type, payload = {}) {
  window.chrome.webview.postMessage({ type, payload })
}

function sanitizeHtml(html) {
  const document = new DOMParser().parseFromString(html || '<p></p>', 'text/html')
  for (const image of document.querySelectorAll('img')) {
    try {
      const url = new URL(image.getAttribute('src') || '')
      if (url.protocol !== 'https:' || url.hostname !== ATTACHMENT_HOST) image.remove()
    } catch {
      image.remove()
    }
  }
  return document.body.innerHTML || '<p></p>'
}

function EditorApp() {
  const [, setStatus] = useState('编辑器桥接初始化中')
  const editorRef = useRef(null)
  const noteIdRef = useRef(null)
  const changeTimerRef = useRef(null)
  const pendingImagesRef = useRef(new Map())

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
    extensions: [StarterKit, Underline, TextAppearance, LocalImage],
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
        if (!images.length) return false
        event.preventDefault()
        images.forEach((image, index) => importImage(image, view.state.selection.from + index))
        return true
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
        undo: () => editor.chain().focus().undo().run(),
        redo: () => editor.chain().focus().redo().run(),
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
      editor.commands.setContent(sanitizeHtml(message.payload.html), { emitUpdate: false })
      editor.setEditable(true)
      setStatus(`已载入：${message.payload.title}`)
      post('note.loaded', { id: noteIdRef.current })
      editor.commands.focus('start')
      emitState(editor)
    }

    window.lightNoteEditor = { getSnapshot }
    window.chrome.webview.addEventListener('message', onMessage)
    post('editor.ready')
    return () => {
      clearTimeout(changeTimerRef.current)
      window.chrome.webview.removeEventListener('message', onMessage)
      delete window.lightNoteEditor
    }
  }, [editor])

  return <EditorContent editor={editor} />
}

createRoot(document.getElementById('root')).render(<EditorApp />)

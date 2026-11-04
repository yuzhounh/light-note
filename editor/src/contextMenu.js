import { getMarkRange } from '@tiptap/core'
import { NodeSelection, Selection } from '@tiptap/pm/state'
import { Fragment, Slice } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { imageLayout, presetImageSize } from './imageSizing.js'

// The document and selection are captured before WebView2 opens its native menu.
// Commands are rejected if a note switch or remote edit has replaced that document.
export function createContextMenuBridge(editor, { openImage, openMath }) {
  const { view } = editor
  let snapshot = null
  let sequence = 0
  const item = (id, label, enabled = true, shortcut = '', checked = false) => ({ id, label, enabled, shortcut, checked })
  const separator = () => ({ separator: true })
  const group = (label, children) => ({ label, enabled: children.some(entry => entry.enabled), children })

  function capture(event, keyboard = event.button !== 2) {
    const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement
    if (!target || (!view.dom.contains(target) && !['BODY', 'HTML'].includes(target.tagName) && target.id !== 'root')) {
      snapshot = null
      return
    }
    const { doc, selection } = view.state
    let pos = selection.from
    if (!keyboard) {
      const hit = view.posAtCoords({ left: event.clientX, top: event.clientY })
      pos = hit?.pos ?? selection.from
    }
    const element = keyboard ? view.domAtPos(pos).node : target
    const anchor = (element.nodeType === 1 ? element : element.parentElement)?.closest('a[href]')
    const object = (element.nodeType === 1 ? element : element.parentElement)?.closest(
      '.resizable-image-wrapper, [data-type="inline-math"], [data-type="block-math"], img',
    )
    let nodePos = null
    let node = null
    if (keyboard && selection instanceof NodeSelection) {
      nodePos = selection.from
      node = selection.node
    } else if (object && view.dom.contains(object)) {
      const at = view.posAtDOM(object, 0)
      for (const candidate of [at, at - 1]) {
        const found = candidate >= 0 && doc.nodeAt(candidate)
        if (found && ['image', 'inlineMath', 'blockMath'].includes(found.type.name)) {
          nodePos = candidate
          node = found
          break
        }
      }
    }
    let next = selection
    if (node && nodePos != null) next = NodeSelection.create(doc, nodePos)
    else if (!keyboard && (selection.empty || pos < selection.from || pos > selection.to)) {
      next = Selection.near(doc.resolve(pos))
    }
    if (!next.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(next))
    let link = null
    if (anchor) {
      const at = view.posAtDOM(anchor, 0)
      const range = getMarkRange(doc.resolve(at), editor.schema.marks.link)
      if (range) link = { ...range, href: anchor.getAttribute('href') }
    }
    const rect = keyboard ? view.coordsAtPos(view.state.selection.from) : null
    const image = node?.type.name === 'image' ? view.nodeDOM(nodePos)?.querySelector('img') : null
    snapshot = {
      id: ++sequence, doc, selection: view.state.selection, node, nodePos, link,
      imageBaseWidth: image ? imageLayout(node.attrs, image.naturalWidth, image.naturalHeight, window.devicePixelRatio || 1).baseWidth : null,
      x: keyboard ? rect.left : event.clientX,
      y: keyboard ? rect.bottom : event.clientY,
    }
  }

  function read() {
    if (!snapshot || snapshot.doc !== view.state.doc) return null
    const { node, link } = snapshot
    const editable = editor.isEditable
    const selected = !snapshot.selection.empty
    const image = node?.type.name === 'image'
    const math = ['inlineMath', 'blockMath'].includes(node?.type.name)
    const imageSrc = image ? node.attrs.src || `https://lightnote.attachments/${node.attrs.attachmentId}` : null
    const items = []
    if (link) {
      items.push(item('link.open', '用默认浏览器打开'), item('link.copy', '复制链接地址'),
        item('link.edit', '编辑链接…', editable), item('link.remove', '取消链接', editable), separator())
    }
    if (image) {
      items.push(item('image.view', '查看大图'), item('image.copy', '复制图片'), item('image.save', '图片另存为…'),
        group('图片尺寸', ['25%', '50%', '75%', '100%'].map(size => item(`image.size.${size}`, size, editable, '', node.attrs.widthPreset === size))),
        separator(), item('object.delete', '删除图片', editable), separator())
    }
    if (math) {
      items.push(item('math.edit', '编辑公式…', editable), item('math.copy', '复制 LaTeX'),
        separator(), item('object.delete', '删除公式', editable), separator())
    }
    items.push(item('undo', '撤销', editable && editor.can().undo(), 'Ctrl+Z'),
      item('redo', '重做', editable && editor.can().redo(), 'Ctrl+Y'), separator(),
      item('cut', '剪切', editable && selected, 'Ctrl+X'), item('copy', '复制', selected, 'Ctrl+C'),
      item('paste', '粘贴', editable, 'Ctrl+V'), item('paste.plain', '粘贴为纯文本', editable, 'Ctrl+Shift+V'),
      separator(), item('selectAll', '全选', docHasContent(), 'Ctrl+A'))
    if (selected && !image && !math) {
      items.push(group('文字格式', [
        item('bold', '加粗', editable, 'Ctrl+B', editor.isActive('bold')),
        item('italic', '斜体', editable, 'Ctrl+I', editor.isActive('italic')),
        item('underline', '下划线', editable, 'Ctrl+U', editor.isActive('underline')),
        item('strike', '删除线', editable, '', editor.isActive('strike')),
        item('clearFormat', '清除格式', editable),
      ]))
    }
    if (editor.isActive('table')) {
      const commands = [
        ['addRowBefore', '上方插入行'], ['addRowAfter', '下方插入行'],
        ['addColumnBefore', '左侧插入列'], ['addColumnAfter', '右侧插入列'],
        ['deleteRow', '删除行'], ['deleteColumn', '删除列'],
        ['resetTableWidth', '重置表宽'], ['equalizeTableColumns', '统一列宽'],
        ['toggleHeaderRow', '切换表头行'], ['deleteTable', '删除整个表格'],
      ]
      items.push(separator(), group('表格操作', commands.flatMap(([command, label]) => [
        ...(command === 'deleteTable' ? [separator()] : []),
        item(command, label, editable && editor.can()[command]()),
      ])))
    }
    return { id: snapshot.id, x: snapshot.x, y: snapshot.y, viewportWidth: document.documentElement.clientWidth,
      items, link: link?.href, imageSrc, latex: math ? node.attrs.latex || '' : null }
  }

  function docHasContent() { return view.state.doc.content.size > 2 }

  function run(id, command, value) {
    if (!snapshot || snapshot.id !== id || snapshot.doc !== view.state.doc) return false
    const { selection, node, nodePos, link } = snapshot
    if (!view.state.selection.eq(selection)) view.dispatch(view.state.tr.setSelection(selection))
    if (command === 'image.view' && node?.type.name === 'image') {
      openImage(node.attrs.src || `https://lightnote.attachments/${node.attrs.attachmentId}`)
      return true
    }
    if (command === 'selectAll') return editor.chain().focus().selectAll().run()
    if (!editor.isEditable) return false
    if (command === 'math.edit' && nodePos != null) {
      openMath({ isExisting: true, isBlock: node.type.name === 'blockMath', latex: node.attrs.latex || '', pos: nodePos })
      return true
    }
    if (command === 'object.delete' && nodePos != null) {
      return editor.chain().focus().deleteRange({ from: nodePos, to: nodePos + node.nodeSize }).run()
    }
    if (command.startsWith('image.size.') && node?.type.name === 'image') {
      return editor.chain().focus().updateAttributes('image', presetImageSize(snapshot.imageBaseWidth || node.attrs.baseWidth || 1080, command.slice(11))).run()
    }
    if ((command === 'link.edit' || command === 'link.remove') && link) {
      return editor.chain().focus().command(({ tr }) => {
        const type = editor.schema.marks.link
        tr.removeMark(link.from, link.to, type)
        if (command === 'link.edit') tr.addMark(link.from, link.to, type.create({ href: value }))
        return true
      }).run()
    }
    if (command === 'paste.plain') {
      view.focus()
      // Insert text nodes directly: paste rules would interpret Markdown even for a plain-text slice.
      const paragraphs = value.replace(/\r\n?/g, '\n').split('\n').map(line =>
        editor.schema.nodes.paragraph.create(null, line ? editor.schema.text(line) : null))
      view.dispatch(closeHistory(view.state.tr).replaceSelection(new Slice(Fragment.fromArray(paragraphs), 1, 1)).scrollIntoView())
      return true
    }
    const commands = {
      undo: 'undo', redo: 'redo', bold: 'toggleBold', italic: 'toggleItalic', underline: 'toggleUnderline', strike: 'toggleStrike',
      addRowBefore: 'addRowBefore', addRowAfter: 'addRowAfter', addColumnBefore: 'addColumnBefore', addColumnAfter: 'addColumnAfter',
      deleteRow: 'deleteRow', deleteColumn: 'deleteColumn', resetTableWidth: 'resetTableWidth',
      equalizeTableColumns: 'equalizeTableColumns', toggleHeaderRow: 'toggleHeaderRow', deleteTable: 'deleteTable',
    }
    if (command === 'clearFormat') return editor.chain().focus().unsetAllMarks().clearNodes().run()
    return commands[command] ? editor.chain().focus()[commands[command]]().run() : false
  }

  const onMouseDown = event => { if (event.button === 2) capture(event, false) }
  const onContextMenu = event => {
    if (event.button !== 2 || !snapshot || snapshot.doc !== view.state.doc) capture(event)
    window.chrome?.webview?.postMessage({ type: 'editor.contextMenu', payload: read() })
  }
  document.addEventListener('mousedown', onMouseDown, true)
  document.addEventListener('contextmenu', onContextMenu, true)
  return {
    read, run,
    reset: () => { snapshot = null },
    destroy() {
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('contextmenu', onContextMenu, true)
      snapshot = null
    },
  }
}

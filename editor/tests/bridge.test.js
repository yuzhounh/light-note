import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'

// Exercise the real React editor and WebView bridge, including its initially disabled state.
const bundle = await build({
  logLevel: 'silent',
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    write: false,
    lib: { entry: 'src/main.jsx', name: 'LightNoteTest', formats: ['iife'] },
  },
})
const code = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(result => result.output).find(item => item.type === 'chunk').code
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

async function openEditor(t) {
  const errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => errors.push(error.message))
  virtualConsole.on('error', error => errors.push(String(error)))
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true, runScripts: 'outside-only', url: 'https://lightnote.editor/', virtualConsole,
  })
  t.after(() => { dom.window.close(); assert.deepEqual(errors, []) })
  const { window } = dom
  window.matchMedia = () => ({ matches: false, addEventListener() {} })
  const emptyRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })
  window.Range.prototype.getBoundingClientRect = emptyRect
  window.Range.prototype.getClientRects = () => []
  window.Element.prototype.getClientRects = () => []
  window.document.elementFromPoint = () => null
  const events = new window.EventTarget()
  const messages = []
  window.chrome = { webview: {
    postMessage: message => messages.push(message),
    addEventListener: (...args) => events.addEventListener(...args),
    removeEventListener: (...args) => events.removeEventListener(...args),
  } }
  window.eval(code)
  for (let attempt = 0; attempt < 100 && !messages.some(m => m.type === 'editor.ready'); attempt++) await delay(10)
  assert.ok(messages.some(m => m.type === 'editor.ready'))
  const send = (type, payload) => events.dispatchEvent(new window.MessageEvent('message', { data: { type, payload } }))
  const load = async (html, id = 'note-1', readOnly = false) => {
    send('note.load', { id, title: '测试笔记', html, readOnly })
    await delay(30)
    return window.document.querySelector('.tiptap').editor
  }
  return { window, messages, send, load }
}

function requestContext(app, editor, selector, position) {
  editor.view.posAtCoords = () => ({ pos: position, inside: -1 })
  const target = editor.view.dom.querySelector(selector) || editor.view.dom
  target.dispatchEvent(new app.window.MouseEvent('mousedown', { button: 2, bubbles: true, clientX: 10, clientY: 10 }))
  target.dispatchEvent(new app.window.MouseEvent('contextmenu', { button: 2, bubbles: true, clientX: 10, clientY: 10 }))
  return app.window.lightNoteEditor.contextMenu.read()
}

test('native context preserves a selected phrase and moves the caret for a click outside it', async t => {
  const app = await openEditor(t)
  const editor = await app.load('<p>abcdef</p><p>second</p>')
  editor.commands.setTextSelection({ from: 2, to: 5 })
  let context = requestContext(app, editor, 'p', 3)
  assert.deepEqual({ from: editor.state.selection.from, to: editor.state.selection.to }, { from: 2, to: 5 })
  assert.equal(context.items.find(item => item.id === 'copy').enabled, true)
  context = requestContext(app, editor, 'p', 6)
  assert.equal(editor.state.selection.empty, true)
  assert.equal(editor.state.selection.from, 6)
  assert.equal(context.items.find(item => item.id === 'copy').enabled, false)
})

test('link menu changes only the clicked link, keeps its label, and supports undo', async t => {
  const app = await openEditor(t)
  const editor = await app.load('<p>before <a href="https://example.com">label</a> after</p>')
  const context = requestContext(app, editor, 'a', 9)
  const bridge = app.window.lightNoteEditor.contextMenu
  assert.equal(context.link, 'https://example.com')
  assert.equal(bridge.run(context.id, 'link.edit', 'https://example.org/new'), true)
  assert.equal(editor.getText(), 'before label after')
  assert.match(editor.getHTML(), /href="https:\/\/example.org\/new"/)
  editor.commands.undo()
  assert.match(editor.getHTML(), /href="https:\/\/example.com"/)
  const next = requestContext(app, editor, 'a', 9)
  assert.equal(bridge.run(next.id, 'link.remove'), true)
  assert.equal(editor.view.dom.querySelector('a'), null)
  assert.equal(editor.getText(), 'before label after')
})

test('context plain paste stays literal, is undoable, and rejects a stale note or read-only edits', async t => {
  const app = await openEditor(t)
  const editor = await app.load('<p>hello</p>')
  const context = requestContext(app, editor, 'p', 6)
  const bridge = app.window.lightNoteEditor.contextMenu
  assert.equal(bridge.run(context.id, 'paste.plain', '**literal** $x^2$'), true)
  assert.equal(editor.getText(), 'hello**literal** $x^2$')
  assert.equal(editor.getHTML().includes('<strong>'), false)
  editor.commands.undo()
  assert.equal(editor.getText(), 'hello')
  await app.load('<p>other note</p>', 'other')
  assert.equal(bridge.run(context.id, 'paste.plain', 'wrong note'), false)
  await app.load('<p>read only</p>', 'readonly', true)
  const readOnly = requestContext(app, editor, 'p', 2)
  assert.equal(readOnly.items.find(item => item.id === 'paste').enabled, false)
  assert.equal(bridge.run(readOnly.id, 'paste.plain', 'forbidden'), false)
  assert.equal(editor.getText(), 'read only')
})

test('image, formula and table context commands target their objects and remain undoable', async t => {
  const app = await openEditor(t)
  const editor = await app.load('<img src="https://lightnote.attachments/test.png" data-image-base-width="800"><p>after</p>')
  let context = requestContext(app, editor, '.resizable-image-wrapper', 0)
  const bridge = app.window.lightNoteEditor.contextMenu
  assert.equal(context.imageSrc, 'https://lightnote.attachments/test.png')
  assert.equal(bridge.run(context.id, 'image.size.50%'), true)
  assert.equal(editor.getJSON().content[0].attrs.width, '540px')
  editor.commands.undo()
  context = requestContext(app, editor, '.resizable-image-wrapper', 0)
  assert.equal(bridge.run(context.id, 'object.delete'), true)
  assert.equal(editor.getText(), 'after')
  editor.commands.undo()
  await app.load('<p><span data-type="inline-math" data-latex="x^2"></span></p>', 'math-context')
  context = requestContext(app, editor, '[data-type="inline-math"]', 1)
  assert.equal(context.latex, 'x^2')
  assert.equal(context.items.some(item => item.id === 'math.edit'), true)
  await app.load('<table><tr><td><p>A</p></td><td><p>B</p></td></tr></table>', 'table-context')
  context = requestContext(app, editor, 'td p', 4)
  assert.equal(context.items.some(item => item.label === '表格操作'), true)
  assert.equal(bridge.run(context.id, 'addRowAfter'), true)
  assert.equal(editor.getJSON().content[0].content.length, 2)
  editor.commands.undo()
  assert.equal(editor.getJSON().content[0].content.length, 1)
})

test('Ctrl plus left click opens externally while ordinary clicks edit and key release clears the cursor', async t => {
  const app = await openEditor(t)
  const editor = await app.load('<p><a href="https://example.com">link</a></p>')
  const opened = []
  app.window.open = url => opened.push(url)
  const anchor = editor.view.dom.querySelector('a')
  const click = (button, ctrlKey) => {
    const event = new app.window.MouseEvent('click', { button, ctrlKey, cancelable: true })
    Object.defineProperty(event, 'target', { value: anchor })
    return editor.options.editorProps.handleClick(editor.view, 1, event)
  }
  assert.equal(click(0, false), false)
  assert.equal(click(0, true), true)
  assert.equal(click(2, true), false)
  assert.deepEqual(opened, ['https://example.com/'])
  app.window.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }))
  assert.equal(editor.view.dom.classList.contains('ctrl-link-open'), true)
  app.window.dispatchEvent(new app.window.KeyboardEvent('keyup', { key: 'Control', ctrlKey: false }))
  assert.equal(editor.view.dom.classList.contains('ctrl-link-open'), false)
  app.window.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }))
  app.window.dispatchEvent(new app.window.Event('blur'))
  assert.equal(editor.view.dom.classList.contains('ctrl-link-open'), false)
})

test('a note containing images permits Enter, text editing, undo and redo after reload', async t => {
  const app = await openEditor(t)
  const editor = await app.load('<p>2026-10-11 22:40:12</p><img src="https://lightnote.attachments/test.png">')
  assert.equal(editor.isEditable, true)
  editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize - 1)
  const blocks = editor.state.doc.childCount
  const event = new app.window.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true })
  editor.view.dom.dispatchEvent(event)
  assert.equal(editor.state.doc.childCount, blocks + 1)
  editor.commands.insertContent('新增文字')
  await delay(250)
  const saved = app.messages.findLast(m => m.type === 'note.changed')?.payload
  assert.match(saved?.html || '', /<p>新增文字<\/p>/)
  await app.load(saved.html)
  assert.equal(editor.isEditable, true)
  assert.ok(editor.commands.undo())
  assert.ok(editor.commands.redo())
  assert.match(editor.getHTML(), /新增文字/)
})

test('image preset and manual widths survive snapshots and reopening', async t => {
  const app = await openEditor(t)
  const editor = await app.load('<p>图片</p><img src="https://lightnote.attachments/test.png" data-attachment-id="test" width="100%">')
  editor.commands.setNodeSelection(editor.state.doc.child(0).nodeSize)
  await delay(30)
  app.window.document.querySelector('[title="75% 默认宽度"]').click()
  await delay(250)
  assert.equal(editor.getJSON().content.find(n => n.type === 'image').attrs.width, '810px')
  const saved = app.messages.findLast(m => m.type === 'note.changed')?.payload
  assert.match(saved?.html || '', /width="810px"/)
  assert.match(saved.html, /data-image-base-width="1080"/)
  await app.load('<p>其他</p>', 'note-2')
  await app.load(saved.html)
  assert.equal(editor.getJSON().content.find(n => n.type === 'image').attrs.width, '810px')
  editor.commands.setNodeSelection(editor.state.doc.child(0).nodeSize)
  await delay(30)
  app.window.document.querySelector('[title="50% 默认宽度"]').click()
  assert.equal(editor.getJSON().content.find(n => n.type === 'image').attrs.width, '540px')
  const wrapper = app.window.document.querySelector('.resizable-image-wrapper')
  Object.defineProperty(wrapper, 'offsetWidth', { value: 300 })
  Object.defineProperty(wrapper.parentElement, 'offsetWidth', { value: 900 })
  const mouse = (target, type, clientX) => target.dispatchEvent(new app.window.MouseEvent(type, { clientX, bubbles: true, cancelable: true }))
  mouse(app.window.document.querySelector('.resizable-image-handle'), 'mousedown', 100)
  mouse(app.window, 'mousemove', 127)
  mouse(app.window, 'mouseup', 127)
  const manual = app.window.lightNoteEditor.getSnapshot()
  assert.match(manual?.html || '', /width="327px"/)
  await app.load('<p>其他</p>', 'note-2')
  await app.load(manual.html)
  assert.equal(editor.getJSON().content.find(n => n.type === 'image').attrs.width, '327px')
})

test('reopened old defaults use 1080 or 360 while manually chosen widths remain unchanged', async t => {
  const app = await openEditor(t)
  await app.load('<p>已有图片</p>' + [
    '<img src="https://lightnote.attachments/wide.png" width="720px" data-image-base-width="720" data-image-width-preset="100%" data-image-pixel-width="2160" data-image-pixel-height="1080">',
    '<img src="https://lightnote.attachments/phone.png" width="360px" data-image-base-width="360" data-image-width-preset="100%" data-image-pixel-width="1080" data-image-pixel-height="2400">',
    '<img src="https://lightnote.attachments/adjusted.png" width="540px" data-image-base-width="720" data-image-width-preset="75%">',
    '<img src="https://lightnote.attachments/dragged.png" width="327px">',
    '<img src="https://lightnote.attachments/manual.png" width="720px" data-image-base-width="720" data-image-width-preset="100%" data-image-width-mode="manual">',
  ].join(''))
  const widths = [...app.window.document.querySelectorAll('.resizable-image-wrapper')].map(element => element.style.width)
  assert.deepEqual(widths, ['1080px', '360px', '540px', '327px', '720px'])
})

test('table controls work with and without images in the note', async t => {
  const app = await openEditor(t)
  const table = '<table><tbody><tr><th><p>列名</p></th></tr><tr><td><p>内容</p></td></tr></tbody></table>'
  for (const [index, image] of ['', '<img src="https://lightnote.attachments/test.png">'].entries()) {
    const editor = await app.load(table + image, `table-${index}`)
    editor.commands.setTextSelection(4)
    await delay(30)
    const buttons = [...app.window.document.querySelectorAll('.table-bar button')]
    assert.ok(buttons.length)
    buttons.find(button => button.textContent === '下方加行').click()
    assert.equal(editor.getJSON().content[0].content.length, 3)
    await delay(220)
    assert.match(app.messages.findLast(m => m.type === 'note.changed').payload.html, /<table/)
  }
})

test('source recording works once per paste, including notes with multiple images', async t => {
  const app = await openEditor(t)
  const images = '<img src="https://lightnote.attachments/test.png">'.repeat(2)
  for (const [index, image] of ['', images].entries()) {
    const editor = await app.load('<p>正文</p>' + image, `paste-${index}`)
    app.send('editor.settings', { recordPasteSource: true })
    editor.commands.setTextSelection(3)
    const event = new app.window.Event('paste', { bubbles: true, cancelable: true })
    event.clipboardData = { items: [], getData: type => type === 'text/plain' ? '外部内容' : '' }
    const before = app.messages.filter(m => m.type === 'clipboard.source.request').length
    editor.view.dom.dispatchEvent(event)
    await delay(20)
    const requests = app.messages.filter(m => m.type === 'clipboard.source.request')
    assert.equal(requests.length, before + 1)
    app.send('clipboard.source', { requestId: requests.at(-1).payload.requestId, label: '测试来源' })
    assert.match(editor.getText(), /外部内容/)
    assert.match(editor.getText(), /测试来源/)
  }
})

test('normal notes stay editable when reopening after trash or clearing the editor', async t => {
  const app = await openEditor(t)
  const editor = await app.load('<p>已删除</p>', 'trash', true)
  assert.equal(editor.isEditable, false)
  await app.load('<p>正常笔记</p>')
  assert.equal(editor.isEditable, true)
  app.send('editor.clear')
  await delay(30)
  assert.equal(editor.isEditable, false)
  await app.load('<p>正常笔记</p>')
  assert.equal(editor.isEditable, true)
  editor.commands.insertContent('可修改')
  assert.match(app.window.lightNoteEditor.getSnapshot().text, /可修改/)
})

test('formula dialogs and deleting images leave ordinary text editable', async t => {
  const app = await openEditor(t)
  const editor = await app.load('<p>正文 <span data-type="inline-math" data-latex="E=mc^2"></span> 文字</p><img src="https://lightnote.attachments/test.png">')
  app.window.document.querySelector('[data-type="inline-math"]').click()
  await delay(30)
  assert.equal(app.window.document.querySelector('textarea').value, 'E=mc^2')
  app.window.document.querySelector('.math-modal-btn-primary').click()
  await delay(30)
  editor.commands.insertContent('公式后可输入')
  assert.match(editor.getHTML(), /data-latex="E=mc\^2"/)
  assert.match(editor.getText(), /公式后可输入/)
  let imagePos
  editor.state.doc.descendants((node, pos) => { if (node.type.name === 'image') imagePos = pos })
  editor.commands.setNodeSelection(imagePos)
  await delay(30)
  app.window.document.querySelector('[title="删除图片"]').click()
  await delay(30)
  editor.commands.focus('end')
  editor.commands.insertContent('删除图片后可输入')
  assert.equal(editor.getJSON().content.some(n => n.type === 'image'), false)
  assert.match(app.window.lightNoteEditor.getSnapshot().text, /删除图片后可输入/)
})

test('late clipboard-source replies cannot modify the next note', async t => {
  const app = await openEditor(t)
  const editor = await app.load('<p>第一篇</p>')
  app.send('editor.settings', { recordPasteSource: true })
  const event = new app.window.Event('paste', { bubbles: true, cancelable: true })
  event.clipboardData = { items: [], getData: type => type === 'text/plain' ? '粘贴文字' : '' }
  editor.view.dom.dispatchEvent(event)
  const request = app.messages.findLast(m => m.type === 'clipboard.source.request')
  await app.load('<p>第二篇</p>', 'note-2')
  app.send('clipboard.source', { requestId: request.payload.requestId, label: '迟到的来源' })
  assert.equal(editor.getHTML(), '<p>第二篇</p>')
})

test('Enter and Backspace work in plain notes before and after image insertion', async t => {
  const app = await openEditor(t)
  const editor = await app.load('<p>第一行</p><p>第二行</p>')
  editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize + 1)
  editor.view.dom.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, bubbles: true, cancelable: true }))
  assert.equal(editor.getText(), '第一行第二行')
  editor.commands.setTextSelection(4)
  editor.view.dom.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }))
  assert.equal(editor.getHTML(), '<p>第一行</p><p>第二行</p>')
  editor.commands.setImage({ src: 'https://lightnote.attachments/test.png' })
  await delay(30)
  editor.commands.focus('end')
  editor.commands.insertContent('图片后正文')
  assert.match(app.window.lightNoteEditor.getSnapshot().text, /图片后正文/)
})

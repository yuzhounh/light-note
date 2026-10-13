import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
for (const key of ['window', 'document', 'navigator', 'DOMParser', 'NodeFilter', 'Node', 'HTMLElement', 'Element', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true, writable: true })
}
// jsdom has no layout; ProseMirror only needs these to exist.
const emptyRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })
window.Range.prototype.getBoundingClientRect = emptyRect
window.Range.prototype.getClientRects = () => []
window.Element.prototype.getClientRects = () => []
window.document.elementFromPoint = () => null

const { Editor } = await import('@tiptap/core')
const { default: StarterKit } = await import('@tiptap/starter-kit')
const { TextSelection } = await import('@tiptap/pm/state')
const { cleanAndConvertHtml, createPasteProps } = await import('../src/clipboard.js')
const { applyNoteContent, clearDocument } = await import('../src/noteDocument.js')

const NOTE = '<p><strong>一句话意象：天在上，地在下，日子在中间。</strong>页面像一幅竖向展开的画卷，保持干净，不放任何画卷元素。</p>'

function createEditor(content = NOTE) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  return new Editor({
    element,
    extensions: [StarterKit],
    content,
    editorProps: createPasteProps({ onImages: () => {} }),
  })
}

// Dispatches a paste event so ProseMirror's own paste handler runs, as in WebView2.
function paste(editor, { html = '', text = '' }) {
  const event = new window.Event('paste', { bubbles: true, cancelable: true })
  event.clipboardData = {
    items: [],
    getData: type => ({ 'text/html': html, 'text/plain': text })[type] || '',
  }
  editor.view.dom.dispatchEvent(event)
}

function select(editor, from, to = from) {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)))
}

// What ProseMirror puts on the clipboard when the range is copied inside the editor.
function copy(editor, from, to) {
  select(editor, from, to)
  const { dom, text } = editor.view.serializeForClipboard(editor.state.selection.content())
  return { html: dom.innerHTML, text }
}

const placeCursor = select

const beforeLastChar = editor => editor.state.doc.content.size - 2

test('a phrase copied inside the note is pasted inline, without new paragraphs', () => {
  const editor = createEditor()
  const clipboard = copy(editor, 1, 4)
  assert.equal(clipboard.text, '一句话')
  // The copied range sits inside a paragraph, so the clipboard HTML carries that paragraph.
  assert.match(clipboard.html, /^<p data-pm-slice="1 1 \[\]"><strong>一句话<\/strong><\/p>$/)

  placeCursor(editor, beforeLastChar(editor))
  paste(editor, clipboard)

  assert.equal(editor.state.doc.childCount, 1)
  assert.equal(editor.getText(), '一句话意象：天在上，地在下，日子在中间。页面像一幅竖向展开的画卷，保持干净，不放任何画卷元素一句话。')
  assert.match(editor.getHTML(), /画卷元素<strong>一句话<\/strong>。<\/p>$/)
  editor.destroy()
})

test('a single paragraph of external HTML joins the paragraph at the cursor', () => {
  const editor = createEditor()
  placeCursor(editor, beforeLastChar(editor))
  paste(editor, { html: '<meta charset="utf-8"><p>外部文字</p>', text: '外部文字' })

  assert.equal(editor.state.doc.childCount, 1)
  assert.match(editor.getText(), /画卷元素外部文字。$/)
  editor.destroy()
})

test('pasted Markdown is converted and joins the paragraph at the cursor', () => {
  const editor = createEditor()
  placeCursor(editor, beforeLastChar(editor))
  paste(editor, { text: '**加粗** 文字' })

  assert.equal(editor.state.doc.childCount, 1)
  assert.match(editor.getHTML(), /画卷元素<strong>加粗<\/strong> 文字。<\/p>$/)
  editor.destroy()
})

test('a title + URL pair is pasted as a line break and a link', () => {
  const editor = createEditor('<p></p>')
  paste(editor, { text: '示例页面\nhttps://example.com/page' })

  assert.equal(editor.state.doc.childCount, 1)
  assert.match(editor.getHTML(), /^<p>示例页面<br><a [^>]*href="https:\/\/example\.com\/page"[^>]*>https:\/\/example\.com\/page<\/a><\/p>$/)
  editor.destroy()
})

test('a paste is a single undo step and can be redone', () => {
  const editor = createEditor()
  const original = editor.getHTML()
  const clipboard = copy(editor, 1, 4)
  placeCursor(editor, beforeLastChar(editor))
  paste(editor, clipboard)
  const pasted = editor.getHTML()

  assert.ok(editor.commands.undo())
  assert.equal(editor.getHTML(), original)
  assert.ok(editor.commands.redo())
  assert.equal(editor.getHTML(), pasted)
  editor.destroy()
})

test('re-sending the open note unchanged keeps undo history and cursor', () => {
  const editor = createEditor()
  placeCursor(editor, 5)
  editor.commands.insertContent('新增')
  const html = editor.getHTML()
  const cursor = editor.state.selection.from

  assert.equal(applyNoteContent(editor, html, { sameNote: true, hasUnsentChanges: false }), 'unchanged')
  assert.equal(editor.state.selection.from, cursor)
  assert.ok(editor.commands.undo())
  assert.equal(editor.getHTML(), NOTE)
  assert.ok(editor.commands.redo())
  assert.equal(editor.getHTML(), html)
  editor.destroy()
})

test('opening another note is not an undo step and starts a fresh history', () => {
  const editor = createEditor()
  editor.commands.insertContent('新增')

  assert.equal(applyNoteContent(editor, '<p>另一篇</p>', { sameNote: false, hasUnsentChanges: false }), 'loaded')
  assert.equal(editor.getHTML(), '<p>另一篇</p>')
  assert.equal(editor.can().undo(), false)
  editor.destroy()
})

test('newer content for the open note replaces it unless local edits are still unsent', () => {
  const editor = createEditor()
  editor.commands.insertContent('新增')
  const local = editor.getHTML()

  assert.equal(applyNoteContent(editor, '<p>来自同步</p>', { sameNote: true, hasUnsentChanges: true }), 'kept')
  assert.equal(editor.getHTML(), local)

  assert.equal(applyNoteContent(editor, '<p>来自同步</p>', { sameNote: true, hasUnsentChanges: false }), 'replaced')
  assert.equal(editor.getHTML(), '<p>来自同步</p>')
  assert.equal(editor.can().undo(), false)
  editor.destroy()
})

test('clearing the editor leaves nothing to undo', () => {
  const editor = createEditor()
  editor.commands.insertContent('新增')
  clearDocument(editor)

  assert.equal(editor.getHTML(), '<p></p>')
  assert.equal(editor.can().undo(), false)
  editor.destroy()
})

test('HTML cleanup keeps formulas, which serialize as empty elements', () => {
  const html = '<p>质能 <span data-latex="E=mc^2" data-type="inline-math"></span> 方程</p><div data-latex="\\sum_i x_i" data-type="block-math"></div><p>a<span> </span>b</p>'
  const cleaned = cleanAndConvertHtml(html)

  assert.match(cleaned, /<span data-latex="E=mc\^2" data-type="inline-math"><\/span>/)
  assert.match(cleaned, /<div data-latex="\\sum_i x_i" data-type="block-math"><\/div>/)
  assert.match(cleaned, /<p>ab<\/p>$/)
})

test('opening saved notes preserves empty list items and repeated hard breaks', () => {
  const editor = createEditor()
  const html = '<p>第一行<br><br>第三行</p><ul><li><p>列表</p></li><li><p></p></li></ul>'
  applyNoteContent(editor, html, { sameNote: false, hasUnsentChanges: false })
  assert.equal(editor.getHTML(), html)
  editor.destroy()
})

test('opening saved notes does not merge paragraphs or reinterpret literal dollar text', () => {
  const editor = createEditor()
  const html = '<p>页面标题 $x$</p><p>https://example.com</p>'
  applyNoteContent(editor, html, { sameNote: false, hasUnsentChanges: false })
  assert.equal(editor.getHTML(), html)
  editor.destroy()
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
for (const key of ['window', 'document', 'navigator', 'DOMParser', 'NodeFilter', 'Node', 'HTMLElement', 'Element', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true, writable: true })
}
const emptyRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })
window.Range.prototype.getBoundingClientRect = emptyRect
window.Range.prototype.getClientRects = () => []
window.Element.prototype.getClientRects = () => []
window.document.elementFromPoint = () => null

const { Editor } = await import('@tiptap/core')
const { default: StarterKit } = await import('@tiptap/starter-kit')
const { insertSourceLine } = await import('../src/pasteSource.js')

function createEditor(content) {
  const element = document.createElement('div')
  document.body.append(element)
  return new Editor({ element, extensions: [StarterKit], content })
}

test('adds a clickable source line after the pasted block', () => {
  const editor = createEditor('<p>第一段</p><p>粘贴的内容</p><p>最后一段</p>')
  const pos = editor.state.doc.child(0).nodeSize + 3 // 位于“粘贴的内容”中间
  assert.equal(insertSourceLine(editor, pos, { label: 'example.com', url: 'https://example.com/a' }), true)
  const doc = editor.getJSON().content
  assert.equal(doc.length, 4)
  assert.equal(doc[2].content[0].text, '来源：')
  assert.equal(doc[2].content[1].text, 'example.com')
  assert.equal(doc[2].content[1].marks[0].attrs.href, 'https://example.com/a')
  assert.equal(doc[3].content[0].text, '最后一段')
  editor.destroy()
})

test('application sources are plain text and duplicates are skipped', () => {
  const editor = createEditor('<p>内容</p>')
  assert.equal(insertSourceLine(editor, 2, { label: 'Word', url: null }), true)
  assert.equal(insertSourceLine(editor, 2, { label: 'Word', url: null }), false)
  const doc = editor.getJSON().content
  assert.equal(doc.length, 2)
  assert.equal(doc[1].content.map(part => part.text).join(''), '来源：Word')
  assert.ok(doc[1].content.every(part => !part.marks))
  editor.destroy()
})

test('does nothing without a label', () => {
  const editor = createEditor('<p>内容</p>')
  assert.equal(insertSourceLine(editor, 2, { label: '', url: null }), false)
  assert.equal(editor.getJSON().content.length, 1)
  editor.destroy()
})

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
const { TableKit } = await import('@tiptap/extension-table')
const { MarkdownGate } = await import('../src/markdownGate.js')

function createEditor(markdownEnabled) {
  const element = document.createElement('div')
  document.body.append(element)
  return new Editor({
    element,
    extensions: [StarterKit, TableKit, MarkdownGate.configure({ isEnabled: () => markdownEnabled.value })],
    content: '<p></p>',
  })
}

// 模拟逐字输入：先交给编辑器的 handleTextInput，没人处理时按 ProseMirror 默认方式插入
function type(editor, text) {
  for (const char of text) {
    const { view } = editor
    const { from, to } = view.state.selection
    const handled = view.someProp('handleTextInput', handler => handler(view, from, to, char))
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to))
  }
}

test('typing "1. " becomes an ordered list while auto format is on', () => {
  const editor = createEditor({ value: true })
  type(editor, '1. ')
  assert.equal(editor.getJSON().content[0].type, 'orderedList')
  editor.destroy()
})

test('typing "1. " stays plain text when auto format is off', () => {
  const editor = createEditor({ value: false })
  type(editor, '1. 内容')
  const first = editor.getJSON().content[0]
  assert.equal(first.type, 'paragraph')
  assert.equal(first.content[0].text, '1. 内容')
  editor.destroy()
})

test('pasted HTML tables keep their rows and cells', () => {
  const editor = createEditor({ value: true })
  editor.commands.setContent(
    '<table><tbody><tr><th>名称</th><th>数量</th></tr><tr><td>苹果</td><td>3</td></tr></tbody></table>')
  const table = editor.getJSON().content[0]
  assert.equal(table.type, 'table')
  assert.equal(table.content.length, 2)
  assert.equal(table.content[0].content[0].type, 'tableHeader')
  assert.equal(table.content[1].content[1].content[0].content[0].text, '3')
  editor.destroy()
})

test('insertTable creates a 3x3 table with a header row', () => {
  const editor = createEditor({ value: true })
  editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
  const table = editor.getJSON().content.find(node => node.type === 'table')
  assert.equal(table.content.length, 3)
  assert.equal(table.content[0].content.length, 3)
  assert.equal(table.content[0].content[0].type, 'tableHeader')
  editor.destroy()
})

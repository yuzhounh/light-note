import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createSizedTable, createTableSizing, tableContext } from '../../editor/src/tableSizing.js'

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
for (const key of ['window', 'document', 'navigator', 'DOMParser', 'NodeFilter', 'Node', 'HTMLElement', 'Element', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'])
  Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true, writable: true })
window.Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
window.Range.prototype.getClientRects = () => []
window.document.elementFromPoint = () => null
const { Editor, Extension } = await import('@tiptap/core')
const { default: StarterKit } = await import('@tiptap/starter-kit')
const { default: Table } = await import('@tiptap/extension-table')
const { default: TableRow } = await import('@tiptap/extension-table-row')
const { default: TableHeader } = await import('@tiptap/extension-table-header')
const { default: TableCell } = await import('@tiptap/extension-table-cell')
const { Plugin, PluginKey, TextSelection } = await import('@tiptap/pm/state')
const { Decoration, DecorationSet } = await import('@tiptap/pm/view')
const { TableMap } = await import('@tiptap/pm/tables')
const { closeHistory } = await import('@tiptap/pm/history')

function open(t, content) {
  const element = document.body.appendChild(document.createElement('div'))
  const editor = new Editor({ element, content, extensions: [StarterKit, createSizedTable(Table, TableMap), TableRow, TableHeader, TableCell,
    createTableSizing({ Extension, Plugin, PluginKey, TextSelection, Decoration, DecorationSet, TableMap, closeHistory })] })
  editor.commands.setTextSelection(4)
  t.after(() => { editor.destroy(); element.remove() })
  return editor
}

test('web v2 preserves desktop-sized columns through HTML, editing and undo', async t => {
  const editor = open(t, '<table data-table-width="1080" data-table-width-mode="fixed"><tr><th colwidth="162">服务器</th><th colwidth="540">运行阶段</th><th colwidth="378">并行数</th></tr><tr><td colwidth="162">40核</td><td colwidth="540">primary_apg</td><td colwidth="378">Jobs 38</td></tr></table>')
  assert.deepEqual(tableContext(editor.state, TableMap).widths, [162, 540, 378])
  editor.commands.setTableColumnWidth(200)
  assert.deepEqual(tableContext(editor.state, TableMap).widths, [200, 502, 378])
  const reopened = open(t, editor.getHTML())
  assert.deepEqual(tableContext(reopened.state, TableMap).widths, [200, 502, 378])
  editor.commands.undo()
  assert.deepEqual(tableContext(editor.state, TableMap).widths, [162, 540, 378])
  editor.commands.equalizeTableColumns()
  assert.deepEqual(tableContext(editor.state, TableMap).widths, [360, 360, 360])
})

test('web auto-sizing records sensible unequal widths and never follows viewport changes', async t => {
  const editor = open(t, '<table><tr><th>服务器</th><th>运行阶段</th><th>并行数</th></tr><tr><td>A</td><td>需要较长描述的运行阶段及后续工作</td><td>Jobs 38</td></tr></table>')
  await new Promise(resolve => setTimeout(resolve, 0))
  const widths = tableContext(editor.state, TableMap).widths
  assert.ok(widths[1] > widths[0])
  assert.equal(widths.reduce((sum, value) => sum + value), 900)
  assert.equal(editor.view.dom.querySelector('table').style.width, '900px')
  editor.view.dom.style.width = '320px'
  editor.commands.insertContent('改变内容'.repeat(30))
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(tableContext(editor.state, TableMap).widths, widths)
})

test('web migrates old LightNote default widths once and preserves column proportions', async t => {
  const editor = open(t, '<table data-table-width="1080"><tr><th colwidth="162">服务器</th><th colwidth="540">运行阶段</th><th colwidth="378">并行数</th></tr></table>')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(tableContext(editor.state, TableMap).widths, [135, 450, 315])
  assert.equal(editor.getJSON().content[0].attrs.tableWidth, 900)
  const reopened = open(t, editor.getHTML())
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(tableContext(reopened.state, TableMap).widths, [135, 450, 315])
})

test('web right border resizes merged tables and roundtrips custom 1080 without default migration', async t => {
  const editor = open(t, '<table data-table-width="900"><tr><th colspan="2" colwidth="300,600">合并标题</th></tr><tr><td colwidth="300">A</td><td colwidth="600">B</td></tr></table>')
  await new Promise(resolve => setTimeout(resolve, 0))
  const cell = editor.view.dom.querySelector('th')
  cell.getBoundingClientRect = () => ({ left: 0, right: 900, top: 0, bottom: 40, width: 900, height: 40 })
  const mouse = (target, type, x) => target.dispatchEvent(new window.MouseEvent(type, { clientX: x, button: 0, bubbles: true, cancelable: true }))
  mouse(cell, 'mousemove', 898)
  assert.ok(editor.view.dom.classList.contains('resize-cursor'))
  const before = editor.getJSON()
  mouse(cell, 'mousedown', 898)
  mouse(window, 'mousemove', 1078)
  assert.equal(editor.view.dom.querySelector('table').style.width, '1080px')
  assert.deepEqual(editor.getJSON(), before)
  mouse(window, 'mouseup', 1078)
  assert.deepEqual(tableContext(editor.state, TableMap).widths, [300, 780])
  assert.deepEqual(editor.getJSON().content[0].content[0].content[0].attrs.colwidth, [300, 780])
  assert.equal(editor.getJSON().content[0].attrs.tableWidthMode, 'fixed')
  const reopened = open(t, editor.getHTML())
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(tableContext(reopened.state, TableMap).widths, [300, 780])
  editor.commands.undo()
  assert.deepEqual(tableContext(editor.state, TableMap).widths, [300, 600])
  editor.commands.redo()
  assert.deepEqual(tableContext(editor.state, TableMap).widths, [300, 780])
})

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
const { Editor, Extension } = await import('@tiptap/core')
const { default: StarterKit } = await import('@tiptap/starter-kit')
const { Table, TableRow, TableHeader, TableCell } = await import('@tiptap/extension-table')
const { Plugin, PluginKey, TextSelection } = await import('@tiptap/pm/state')
const { Decoration, DecorationSet } = await import('@tiptap/pm/view')
const { TableMap } = await import('@tiptap/pm/tables')
const { createSizedTable, createTableSizing, tableContext, tableWidths, resizeTableWidths } = await import('../src/tableSizing.js')

const html = '<table><tbody><tr><th>服务器</th><th>运行阶段</th><th>并行数</th></tr><tr><td>40核</td><td>primary_apg</td><td>Jobs 38</td></tr></tbody></table><p>继续编辑</p>'
const equalHtml = html.replaceAll('<th>', '<th colwidth="360">').replaceAll('<td>', '<td colwidth="360">')
function open(t, content = equalHtml) {
  const element = document.body.appendChild(document.createElement('div'))
  const editor = new Editor({ element, extensions: [StarterKit, createSizedTable(Table, TableMap), TableRow, TableHeader, TableCell,
    createTableSizing({ Extension, Plugin, PluginKey, TextSelection, Decoration, DecorationSet, TableMap })], content })
  editor.commands.setTextSelection(4)
  t.after(() => { editor.destroy(); element.remove() })
  return editor
}

test('legacy tables allocate width by content, keep a fixed total and reopen unchanged', t => {
  const editor = open(t, html)
  const initial = tableContext(editor.state, TableMap).widths
  assert.equal(editor.view.dom.querySelector('table').style.width, '900px')
  assert.equal(initial.reduce((a, b) => a + b), 900)
  assert.ok(initial[0] < initial[1])
  assert.ok(initial.every(width => width >= 80))
  const saved = editor.getHTML()
  assert.match(saved, /data-table-width="900"/)
  assert.match(saved, /data-table-width-mode="default"/)
  assert.match(saved, /width: 900px/)
  const reopened = open(t, saved)
  assert.deepEqual(tableContext(reopened.state, TableMap).widths, initial)
  editor.view.dom.style.width = '300px'
  window.dispatchEvent(new window.Event('resize'))
  assert.equal(editor.view.dom.querySelector('table').style.width, '900px')
})

test('numeric column sizing preserves total, whole column, undo, redo and reopening', t => {
  const editor = open(t)
  assert.equal(editor.commands.setTableColumnWidth(162), true)
  assert.deepEqual(tableContext(editor.state, TableMap).widths, [162, 558, 360])
  const rows = editor.getJSON().content[0].content
  assert.deepEqual(rows[0].content[0].attrs.colwidth, [162])
  assert.deepEqual(rows[1].content[0].attrs.colwidth, [162])
  const reopened = open(t, editor.getHTML())
  assert.deepEqual(tableContext(reopened.state, TableMap).widths, [162, 558, 360])
  editor.commands.undo()
  assert.deepEqual(tableContext(editor.state, TableMap).widths, [360, 360, 360])
  editor.commands.redo()
  assert.deepEqual(tableContext(editor.state, TableMap).widths, [162, 558, 360])
  editor.commands.equalizeTableColumns()
  assert.deepEqual(tableContext(editor.state, TableMap).widths, [360, 360, 360])
})

test('drag previews do not change the document; release commits once and Escape cancels', t => {
  const editor = open(t)
  const mouse = (target, type, x) => target.dispatchEvent(new window.MouseEvent(type, { clientX: x, clientY: 20, button: 0, buttons: 1, bubbles: true, cancelable: true }))
  const first = editor.view.dom.querySelector('th')
  first.getBoundingClientRect = () => ({ ...emptyRect(), left: 0, right: 360, width: 360 })
  mouse(first, 'mousemove', 358)
  assert.ok(editor.view.dom.classList.contains('resize-cursor'))
  assert.ok(editor.view.dom.querySelector('.column-resize-handle'))
  const before = editor.getJSON()
  mouse(first, 'mousedown', 358)
  mouse(window, 'mousemove', 160)
  assert.deepEqual(editor.getJSON(), before)
  assert.equal(editor.view.dom.querySelector('col').style.width, '162px')
  mouse(window, 'mouseup', 160)
  assert.deepEqual(tableContext(editor.state, TableMap).widths, [162, 558, 360])
  first.getBoundingClientRect = () => ({ ...emptyRect(), left: 0, right: 162, width: 162 })
  mouse(first, 'mousemove', 160)
  mouse(first, 'mousedown', 160)
  mouse(window, 'mousemove', 250)
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  assert.deepEqual(tableContext(editor.state, TableMap).widths, [162, 558, 360])
  assert.equal(editor.view.dom.querySelector('col').style.width, '162px')
})

test('merged cells and added/deleted rows retain logical column widths', t => {
  const editor = open(t, '<table><tr><th colspan="2" colwidth="360,360">阶段</th><th colwidth="360">并行</th></tr><tr><td colwidth="360">A</td><td colwidth="360">B</td><td colwidth="360">C</td></tr></table>')
  editor.commands.setTextSelection(4)
  editor.commands.setTableColumnWidth(162)
  assert.deepEqual(editor.getJSON().content[0].content[0].content[0].attrs.colwidth, [162, 558])
  assert.deepEqual(tableWidths(editor.state.doc.child(0), TableMap), [162, 558, 360])
  editor.commands.addRowAfter()
  assert.deepEqual(tableWidths(editor.state.doc.child(0), TableMap), [162, 558, 360])
  editor.commands.deleteRow()
  assert.deepEqual(tableWidths(editor.state.doc.child(0), TableMap), [162, 558, 360])
})

test('automatic widths are recorded once; editing longer text never reflows columns', async t => {
  const editor = open(t, html)
  await new Promise(resolve => setTimeout(resolve, 0))
  const initial = tableContext(editor.state, TableMap).widths
  assert.ok(editor.getJSON().content[0].content[0].content.every(cell => cell.attrs.colwidth?.length))
  editor.commands.insertContent('增加很长的描述'.repeat(30))
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(tableContext(editor.state, TableMap).widths, initial)
})

test('old default 1080 scales each column proportionally once, including merged cells', async t => {
  const editor = open(t, '<table data-table-width="1080"><tr><th colspan="2" colwidth="118,456">阶段</th><th colwidth="506">并行</th></tr><tr><td colwidth="118">A</td><td colwidth="456">B</td><td colwidth="506">C</td></tr></table>')
  assert.deepEqual(tableContext(editor.state, TableMap).widths, [98, 380, 422])
  assert.equal(editor.view.dom.querySelector('table').style.width, '900px')
  await new Promise(resolve => setTimeout(resolve, 0))
  const table = editor.getJSON().content[0]
  assert.equal(table.attrs.tableWidth, 900)
  assert.equal(table.attrs.tableWidthMode, 'default')
  assert.deepEqual(table.content[0].content[0].attrs.colwidth, [98, 380])
  assert.deepEqual(table.content[1].content.map(cell => cell.attrs.colwidth[0]), [98, 380, 422])
  const reopened = open(t, editor.getHTML())
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(tableContext(reopened.state, TableMap).widths, [98, 380, 422])
})

test('explicit custom totals, including fixed 1080, are preserved', async t => {
  for (const [total, widths] of [[1080, [162, 540, 378]], [1200, [200, 600, 400]]]) {
    const cells = widths.map(width => `<th colwidth="${width}">内容</th>`).join('')
    const editor = open(t, `<table data-table-width="${total}" data-table-width-mode="fixed"><tr>${cells}</tr></table>`)
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(tableContext(editor.state, TableMap).widths, widths)
    assert.equal(editor.view.dom.querySelector('table').style.width, `${total}px`)
  }
})

test('right border changes only the last column, saves fixed width, supports undo and cancel', async t => {
  const editor = open(t, '<table><tr><th colwidth="450">设备之间</th><th colwidth="450">平均速度</th></tr><tr><td colwidth="450">家里</td><td colwidth="450">0.156 MB/s</td></tr></table>')
  await new Promise(resolve => setTimeout(resolve, 0))
  const mouse = (target, type, x) => target.dispatchEvent(new window.MouseEvent(type, { clientX: x, button: 0, bubbles: true, cancelable: true }))
  const last = editor.view.dom.querySelectorAll('th')[1]
  last.getBoundingClientRect = () => ({ ...emptyRect(), left: 450, right: 900, width: 450 })
  mouse(last, 'mousemove', 898)
  assert.ok(editor.view.dom.querySelector('.column-resize-handle'))
  const before = editor.getJSON()
  let updates = 0
  editor.on('update', () => updates++)
  mouse(last, 'mousedown', 898)
  mouse(window, 'mousemove', 598)
  assert.equal(editor.view.dom.querySelector('table').style.width, '600px')
  assert.equal(editor.view.dom.querySelector('col').style.width, '450px')
  assert.deepEqual(editor.getJSON(), before)
  assert.equal(updates, 0)
  mouse(window, 'mouseup', 598)
  assert.equal(updates, 1)
  assert.deepEqual(tableContext(editor.state, TableMap).widths, [450, 150])
  assert.deepEqual(editor.getJSON().content[0].content[1].content.map(cell => cell.attrs.colwidth), [[450], [150]])
  assert.equal(editor.getJSON().content[0].attrs.tableWidthMode, 'fixed')
  const reopened = open(t, editor.getHTML())
  assert.deepEqual(tableContext(reopened.state, TableMap).widths, [450, 150])
  editor.commands.undo()
  assert.deepEqual(tableContext(editor.state, TableMap).widths, [450, 450])
  editor.commands.redo()
  assert.deepEqual(tableContext(editor.state, TableMap).widths, [450, 150])
  last.getBoundingClientRect = () => ({ ...emptyRect(), left: 450, right: 600, width: 150 })
  mouse(last, 'mousemove', 598)
  mouse(last, 'mousedown', 598)
  mouse(window, 'mousemove', 798)
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  assert.equal(editor.view.dom.querySelector('table').style.width, '600px')
  assert.deepEqual(tableContext(editor.state, TableMap).widths, [450, 150])
  const first = editor.view.dom.querySelector('th')
  first.getBoundingClientRect = () => ({ ...emptyRect(), left: 0, right: 450, width: 450 })
  mouse(first, 'mousemove', 1)
  assert.equal(editor.view.dom.classList.contains('resize-cursor'), false)
})

test('outer resizing preserves all preceding columns when shrinking, growing and reaching the minimum', () => {
  assert.deepEqual(resizeTableWidths([300, 600], 600), [300, 300])
  assert.deepEqual(resizeTableWidths([100, 800], 400), [100, 300])
  assert.deepEqual(resizeTableWidths([100, 800], -200), [100, 80])
  assert.deepEqual(resizeTableWidths([900], 500), [500])
  assert.deepEqual(resizeTableWidths([250, 250], 1080), [250, 830])
  assert.deepEqual(resizeTableWidths([95, 490, 315], 600), [95, 490, 80])
})

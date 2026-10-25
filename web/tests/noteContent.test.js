import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { patchNote, withEditorContent } from '../src/core/noteContent.js'

const { window } = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
for (const key of ['window', 'document', 'navigator', 'DOMParser', 'NodeFilter', 'Node', 'HTMLElement', 'Element', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'])
  Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true, writable: true })
window.Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
window.Range.prototype.getClientRects = () => []
window.document.elementFromPoint = () => null
const { Editor } = await import('@tiptap/core')
const { default: StarterKit } = await import('@tiptap/starter-kit')
const { contentSnapshot } = await import('../src/editor/contentSnapshot.js')

function countingSnapshot(values) {
  const reads = { html: 0, text: 0, json: 0 }
  return { reads, snapshot: {
    get html() { reads.html++; return values.html },
    get text() { reads.text++; return values.text },
    get json() { reads.json++; return values.json },
  } }
}

test('typing builds a note without serializing; fields serialize once on first read', () => {
  const note = { id: 'n', title: 'T', body_html: '<p>old</p>', body_text: 'old', body_json: '{}' }
  const { reads, snapshot } = countingSnapshot({ html: '<p>new</p>', text: 'new', json: { type: 'doc' } })
  const updated = withEditorContent(note, snapshot)
  assert.deepEqual(reads, { html: 0, text: 0, json: 0 })
  assert.equal(updated.content_snapshot, snapshot)
  assert.equal(updated.body_text, 'new')
  assert.equal(updated.body_json, '{"type":"doc"}')
  assert.equal(updated.body_json, '{"type":"doc"}')
  assert.deepEqual(reads, { html: 0, text: 1, json: 1 })
  assert.equal(note.body_html, '<p>old</p>', 'the previous note is unchanged')
})

test('a title change keeps the body lazy; a spread or JSON reads plain strings without the snapshot', () => {
  const { reads, snapshot } = countingSnapshot({ html: '<p>x</p>', text: 'x', json: { type: 'doc' } })
  const titled = patchNote(withEditorContent({ id: 'n', title: 'Old' }, snapshot), { title: 'New' })
  assert.equal(titled.title, 'New')
  assert.deepEqual(reads, { html: 0, text: 0, json: 0 })
  assert.equal(titled.content_snapshot, snapshot)
  const plain = { ...titled }
  assert.equal(plain.body_html, '<p>x</p>')
  assert.equal('content_snapshot' in plain, false)
  assert.deepEqual(JSON.parse(JSON.stringify(titled)), { id: 'n', title: 'New', body_html: '<p>x</p>', body_text: 'x', body_json: '{"type":"doc"}' })
})

test('an editor snapshot matches getHTML/getText/getJSON and keeps the content of its keystroke', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit],
    content: '<h1>Title</h1><p>First <strong>bold</strong></p><ul><li><p>item</p></li></ul>' })
  const snapshot = contentSnapshot(editor)
  assert.equal(snapshot.html, editor.getHTML())
  assert.equal(snapshot.text, editor.getText())
  assert.deepEqual(snapshot.json, editor.getJSON())
  const before = editor.getHTML()
  const later = contentSnapshot(editor)
  editor.commands.setContent('<p>Replaced</p>')
  assert.equal(later.html, before, 'a snapshot is not affected by later edits')
  editor.destroy()
})

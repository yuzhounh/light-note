import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createNoteListLoader } from '../src/core/db/noteListLoader.js'

function harness(getNotes) {
  const state = { view: { currentNotebookId: null, currentView: 'all', searchQuery: '',
    noteSort: { by: 'updated', descending: true }, isMobile: false }, notes: [], active: null }
  const entries = new Map()
  const drafts = { generation: 0, get: id => entries.get(id) }
  const load = createNoteListLoader({ repository: { getNotes }, drafts, getView: () => state.view,
    setNotes: update => { state.notes = update(state.notes) },
    setActiveNote: update => { state.active = update(state.active) } })
  return { state, entries, drafts, load }
}

test('switching notebooks selects the first displayed note even if the old note is still in that notebook', async () => {
  const first = { id: 'a1' }, second = { id: 'a2' }, other = { id: 'b1' }
  const h = harness(async ({ notebookId }) => notebookId === 'b' ? [other] : [first, second])
  await h.load()
  h.state.active = second
  h.state.view = { ...h.state.view, currentNotebookId: 'a' }
  await h.load()
  assert.equal(h.state.active.id, 'a1')
  h.state.view = { ...h.state.view, currentNotebookId: 'b' }
  await h.load()
  assert.deepEqual(h.state.notes, [other])
  assert.equal(h.state.active.id, 'b1')
})

test('same-notebook refresh keeps the selected draft; empty notebooks clear the editor without discarding drafts', async () => {
  const h = harness(async ({ notebookId }) => notebookId === 'empty' ? [] : [{ id: 'a1' }, { id: 'a2' }])
  await h.load()
  const draft = { id: 'a2', body_html: '<p>unsaved</p>' }
  h.entries.set('a2', draft)
  h.state.active = draft
  await h.load()
  assert.equal(h.state.active, draft)
  h.state.view = { ...h.state.view, currentNotebookId: 'empty' }
  await h.load()
  assert.equal(h.state.active, null)
  assert.deepEqual(h.state.notes, [])
  assert.equal(h.entries.get('a2'), draft)
})

test('a slower previous-notebook response cannot replace the latest list or editor', async () => {
  const pending = []
  const h = harness(() => new Promise(resolve => pending.push(resolve)))
  const old = h.load()
  h.state.view = { ...h.state.view, currentNotebookId: 'new' }
  const latest = h.load()
  pending[1]([{ id: 'new-first' }])
  await latest
  pending[0]([{ id: 'old-first' }])
  await old
  assert.equal(h.state.active.id, 'new-first')
  assert.deepEqual(h.state.notes, [{ id: 'new-first' }])
})

test('mobile notebook changes keep the list view without automatically opening a note', async () => {
  const h = harness(async () => [{ id: 'first' }])
  h.state.view = { ...h.state.view, isMobile: true }
  await h.load()
  assert.equal(h.state.active, null)
  assert.equal(h.state.notes[0].id, 'first')
})

import 'fake-indexeddb/auto'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { liveQuery } from 'dexie'
import { db } from '../src/core/db/database.js'
import { NotesRepository } from '../src/core/db/notesRepository.js'

after(() => db.delete())

test('notebook totals react to local and sync changes independently of search and trash', async () => {
  await db.notes.bulkPut([
    ...Array.from({ length: 61 }, (_, i) => ({ id: `note-${i}`, notebook_id: 'a', title: 'Research' })),
    { id: 'trash', notebook_id: 'a', is_deleted: 1 },
    { id: 'purged', notebook_id: 'a', purged_at: new Date().toISOString() },
    { id: 'unfiled' },
  ])
  const updates = []
  let notify
  const subscription = liveQuery(() => NotesRepository.getNotebookCounts()).subscribe(counts => {
    updates.push(counts)
    notify?.()
  })
  async function expectCounts(a, b) {
    const match = () => updates.length &&
      (updates.at(-1).get('a') || 0) === a && (updates.at(-1).get('b') || 0) === b
    if (!match()) await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { notify = null; reject(new Error('Counts did not refresh')) }, 3000)
      notify = () => { if (match()) { clearTimeout(timeout); notify = null; resolve() } }
    })
    assert.equal(updates.at(-1).get('a') || 0, a)
    assert.equal(updates.at(-1).get('b') || 0, b)
  }
  try {
    await expectCounts(61, 0)
    assert.equal((await NotesRepository.getNotes({ notebookId: 'a', searchQuery: 'no match' })).length, 0)
    assert.equal((await NotesRepository.getNotes({ view: 'trash' })).length, 1)
    assert.equal((await NotesRepository.getNotebookCounts()).get('a'), 61)
    const note = await NotesRepository.createNote({ notebookId: 'a' })
    await expectCounts(62, 0)
    await db.notes.update(note.id, { notebook_id: 'b' })
    await expectCounts(61, 1)
    await NotesRepository.softDeleteNote(note.id)
    await expectCounts(61, 0)
    await NotesRepository.restoreNote(note.id)
    await expectCounts(61, 1)
    await NotesRepository.permanentDeleteNote(note.id)
    await expectCounts(61, 0)
    // Sync/import writes go straight to the same table, bypassing local action handlers.
    await db.notes.put({ id: 'remote', notebook_id: 'b' })
    await expectCounts(61, 1)
  } finally {
    subscription.unsubscribe()
  }
})

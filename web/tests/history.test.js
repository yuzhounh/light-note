import 'fake-indexeddb/auto'
import { after, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/core/db/database.js'
import { NotesRepository } from '../src/core/db/notesRepository.js'
import { noteDrafts } from '../src/core/sync/noteDrafts.js'
import { syncService } from '../src/core/sync/syncService.js'

const save = (id, title) => NotesRepository.saveNote(id, {
  title, bodyHtml: `<p>${title}</p>`, bodyText: title,
  bodyJson: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: title }] }] })
})

beforeEach(async () => {
  mock.timers.reset()
  for (const id of noteDrafts.entries.keys()) noteDrafts.discard(id)
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear()
  })
})
after(async () => {
  mock.timers.reset()
  clearTimeout(syncService._pushTimeout)
  await db.close()
})

test('rapid autosaves keep one snapshot per editing session and restore keeps current content', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-07T00:00:00.000Z') })
  const note = await NotesRepository.createNote({ title: 'v1', bodyHtml: '<p>v1</p>', bodyText: 'v1' })

  await save(note.id, 'v2')
  mock.timers.tick(60 * 1000)
  await save(note.id, 'v3')
  mock.timers.tick(60 * 1000)
  await save(note.id, 'v4')
  let versions = await NotesRepository.getNoteVersions(note.id)
  assert.equal(versions.length, 1)
  assert.equal(versions[0].title, 'v1')

  mock.timers.tick(15 * 60 * 1000)
  await save(note.id, 'v5')
  versions = await NotesRepository.getNoteVersions(note.id)
  assert.equal(versions.length, 2)
  assert.equal(versions[0].title, 'v4')

  const restored = await NotesRepository.restoreNoteVersion(note.id, versions[1].id)
  assert.equal(restored.title, 'v1')
  versions = await NotesRepository.getNoteVersions(note.id)
  assert.equal(versions.length, 3)
  assert.equal(versions[0].title, 'v5')
})

test('versions are capped at fifty and removed with the purged note', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-07T00:00:00.000Z') })
  const note = await NotesRepository.createNote({ title: 'n0', bodyHtml: '<p>n0</p>', bodyText: 'n0' })
  for (let i = 1; i <= 60; i++) {
    mock.timers.tick(11 * 60 * 1000)
    await save(note.id, `n${i}`)
  }
  const versions = await NotesRepository.getNoteVersions(note.id)
  assert.equal(versions.length, 50)
  assert.equal(versions[0].title, 'n59')

  await NotesRepository.permanentDeleteNote(note.id)
  assert.equal((await NotesRepository.getNoteVersions(note.id)).length, 0)
})

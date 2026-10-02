import 'fake-indexeddb/auto'
import { after, afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { db, deduplicateNotebooks, DEFAULT_NOTEBOOK_ID } from '../src/core/db/database.js'
import { NotesRepository } from '../src/core/db/notesRepository.js'
import { noteDrafts } from '../src/core/sync/noteDrafts.js'
import { mergeRemoteNote, mergeRemoteNotebook, pushPendingChanges } from '../src/core/sync/syncStore.js'
import { buildSyncPayload } from '../src/core/sync/syncPayload.js'
import { syncService } from '../src/core/sync/syncService.js'

const past = '2026-09-01T00:00:00.000Z'
const future = '2099-01-01T00:00:00.000Z'
const remoteNote = (changes = {}) => ({
  id: 'note-1', title: 'Desktop title', bodyHtml: '<p>desktop</p>', bodyText: 'desktop',
  bodyJson: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"desktop"}]}]}',
  createdAt: past, updatedAt: past, deletedAt: null, purgedAt: null,
  version: 3, tags: ['研究', 'desktop'], ...changes
})
const save = (id, title) => NotesRepository.saveNote(id, {
  title, bodyHtml: `<p>${title}</p>`, bodyText: title,
  bodyJson: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: title }] }] })
})

beforeEach(async () => {
  for (const id of noteDrafts.entries.keys()) noteDrafts.discard(id)
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear()
  })
})
after(async () => {
  for (const id of noteDrafts.entries.keys()) noteDrafts.discard(id)
  await db.delete()
})
afterEach(() => {
  syncService.currentUser = null
  syncService.stopRealtimeSync()
})

test('pending drafts survive full pulls, snapshots and remote deletion regardless of clock', async () => {
  await mergeRemoteNote(remoteNote())
  await save('note-1', 'Unuploaded browser draft')
  for (const updatedAt of [past, new Date().toISOString(), future]) {
    for (const type of ['added', 'modified', 'removed']) {
      assert.equal(await mergeRemoteNote(remoteNote({ updatedAt, deletedAt: updatedAt, purgedAt: updatedAt }), type), false)
      assert.equal((await db.notes.get('note-1')).title, 'Unuploaded browser draft')
      assert.equal(await db.sync_outbox.count(), 1)
    }
  }
})

test('editor debounce protects unsaved content and holds back its old upload', async () => {
  await mergeRemoteNote(remoteNote())
  await save('note-1', 'Previous saved draft')
  const draft = { id: 'note-1', title: 'Still typing' }
  noteDrafts.schedule(draft, note => save(note.id, note.title))
  assert.equal(await mergeRemoteNote(remoteNote({ updatedAt: future })), false)
  let uploads = 0
  await pushPendingChanges(async () => { uploads++ })
  assert.equal(uploads, 0)
  assert.equal(noteDrafts.get('note-1'), draft)
  await noteDrafts.flushAll()
  assert.equal((await db.notes.get('note-1')).title, 'Still typing')
  await pushPendingChanges(async (_, __, note) => { assert.equal(note.title, 'Still typing'); uploads++ })
  assert.equal(uploads, 1)
})

test('a clean note is also protected before its first debounced save', async () => {
  await mergeRemoteNote(remoteNote())
  noteDrafts.schedule({ id: 'note-1', title: 'New keystrokes' }, note => save(note.id, note.title))
  assert.equal(await db.sync_outbox.count(), 0)
  assert.equal(await mergeRemoteNote(remoteNote({ updatedAt: future })), false)
  await noteDrafts.flushAll()
  assert.equal((await db.notes.get('note-1')).title, 'New keystrokes')
})

test('switching notes does not cancel another note save', async () => {
  await mergeRemoteNote(remoteNote())
  await mergeRemoteNote(remoteNote({ id: 'note-2' }))
  for (const id of ['note-1', 'note-2']) {
    noteDrafts.schedule({ id, title: `Draft ${id}` }, note => save(note.id, note.title))
  }
  await noteDrafts.flushAll()
  assert.equal((await db.notes.get('note-1')).title, 'Draft note-1')
  assert.equal((await db.notes.get('note-2')).title, 'Draft note-2')
  assert.equal(await db.sync_outbox.count(), 2)
})

test('edits made while upload is in flight keep a fresh queue acknowledgement', async () => {
  await mergeRemoteNote(remoteNote())
  await save('note-1', 'First upload')
  const first = await db.sync_outbox.toCollection().first()
  let release
  let started
  const uploadStarted = new Promise(resolve => { started = resolve })
  const uploading = pushPendingChanges(async (_, __, note) => {
    assert.equal(note.title, 'First upload')
    started()
    await new Promise(resolve => { release = resolve })
  })
  await uploadStarted
  await save('note-1', 'Edited during upload')
  release()
  await uploading
  const pending = await db.sync_outbox.toArray()
  assert.equal(pending.length, 1)
  assert.ok(pending[0].id > first.id)
  assert.equal(await mergeRemoteNote(remoteNote({ updatedAt: future })), false)
  await pushPendingChanges(async (_, __, note) => assert.equal(note.title, 'Edited during upload'))
  assert.equal(await db.sync_outbox.count(), 0)
})

test('upload failure preserves the queue and retry sends the draft', async () => {
  await mergeRemoteNote(remoteNote())
  await save('note-1', 'Offline draft')
  await assert.rejects(pushPendingChanges(async () => { throw new Error('offline') }), /offline/)
  assert.equal(await db.sync_outbox.count(), 1)
  await pushPendingChanges(async (_, __, note) => assert.equal(note.title, 'Offline draft'))
  assert.equal(await db.sync_outbox.count(), 0)
})

test('desktop tags and the edited JSON body survive a browser round trip', async () => {
  await mergeRemoteNote(remoteNote())
  await save('note-1', 'Web content')
  await pushPendingChanges(async (type, _, note) => {
    const payload = buildSyncPayload(type, note)
    assert.deepEqual(payload.tags, ['研究', 'desktop'])
    assert.equal(payload.bodyHtml, '<p>Web content</p>')
    assert.equal(JSON.parse(payload.bodyJson).content[0].content[0].text, 'Web content')
    assert.ok(payload.serverUpdatedAt)
  })
})

test('unknown tags are omitted, while known tags survive a remote payload without tags', async () => {
  const withoutTags = remoteNote()
  delete withoutTags.tags
  await mergeRemoteNote(withoutTags)
  assert.equal(Object.hasOwn(buildSyncPayload('note', await db.notes.get('note-1')), 'tags'), false)
  await mergeRemoteNote(remoteNote({ updatedAt: '2026-09-02T00:00:00.000Z' }))
  await mergeRemoteNote({ ...withoutTags, updatedAt: future })
  assert.deepEqual(buildSyncPayload('note', await db.notes.get('note-1')).tags, ['研究', 'desktop'])
})

test('browser trash, restore and permanent deletion use desktop-compatible fields', async () => {
  await mergeRemoteNote(remoteNote())
  await NotesRepository.softDeleteNote('note-1')
  assert.equal((await NotesRepository.getNotes({ view: 'trash' })).length, 1)
  assert.ok(buildSyncPayload('note', await db.notes.get('note-1')).deletedAt)
  await NotesRepository.restoreNote('note-1')
  assert.equal(buildSyncPayload('note', await db.notes.get('note-1')).deletedAt, null)
  await NotesRepository.permanentDeleteNote('note-1')
  const tombstone = await db.notes.get('note-1')
  assert.ok(tombstone.purged_at)
  assert.equal(tombstone.body_text, '')
  assert.deepEqual(tombstone.tags, [])
  assert.equal(await NotesRepository.getNoteById('note-1'), undefined)
  assert.deepEqual(await NotesRepository.getNotes({ view: 'trash' }), [])
  await pushPendingChanges(async (type, _, note) => assert.ok(buildSyncPayload(type, note).purgedAt))
  await NotesRepository.restoreNote('note-1')
  await save('note-1', 'Late autosave')
  assert.equal((await db.notes.get('note-1')).body_text, '')
  assert.equal(await db.sync_outbox.count(), 0)
})

test('desktop soft delete, restore and purge are reflected in browser views', async () => {
  await mergeRemoteNote(remoteNote({ deletedAt: past }))
  assert.equal((await NotesRepository.getNotes({ view: 'trash' })).length, 1)
  await mergeRemoteNote(remoteNote({ updatedAt: '2026-09-02T00:00:00.000Z' }))
  assert.equal((await NotesRepository.getNotes()).length, 1)
  await mergeRemoteNote(remoteNote({ updatedAt: future, deletedAt: future, purgedAt: future }))
  assert.deepEqual(await NotesRepository.getNotes(), [])
  assert.deepEqual(await NotesRepository.getNotes({ view: 'trash' }), [])
})

test('empty trash queues durable tombstones for every deleted note', async () => {
  for (const id of ['note-1', 'note-2']) await mergeRemoteNote(remoteNote({ id, deletedAt: past }))
  await NotesRepository.emptyTrash()
  assert.equal(await db.sync_outbox.count(), 2)
  assert.ok((await db.notes.toArray()).every(note => note.purged_at))
})

test('notebook deletions and pending renames survive pulls and deduplication', async () => {
  await db.notebooks.put({ id: DEFAULT_NOTEBOOK_ID, name: 'Same', updated_at: past })
  const notebook = await NotesRepository.createNotebook('Local')
  await NotesRepository.updateNotebook(notebook.id, { name: 'Same' })
  assert.equal(await mergeRemoteNotebook({ id: notebook.id, name: 'Remote', updatedAt: future }), false)
  await deduplicateNotebooks()
  assert.equal((await db.notebooks.get(notebook.id)).name, 'Same')
  await NotesRepository.deleteNotebook(notebook.id)
  await deduplicateNotebooks()
  assert.ok((await db.notebooks.get(notebook.id)).deleted_at)
  await pushPendingChanges(async (type, _, record) => assert.ok(buildSyncPayload(type, record).deletedAt))
  assert.equal((await NotesRepository.getAllNotebooks()).length, 1)
})

test('legacy hard delete queues are upgraded and cannot replay an older upsert', async () => {
  await db.sync_outbox.add({ entity_type: 'note', entity_id: 'legacy', action: 'upsert', created_at: past })
  await db.sync_outbox.add({ entity_type: 'note', entity_id: 'legacy', action: 'delete', created_at: past })
  await db.sync_outbox.add({ entity_type: 'notebook', entity_id: 'legacy-nb', action: 'delete', created_at: past })
  let count = 0
  await pushPendingChanges(async (type, _, record) => {
    const payload = buildSyncPayload(type, record)
    assert.ok(payload.deletedAt)
    if (type === 'note') assert.ok(payload.purgedAt)
    count++
  })
  assert.equal(count, 2)
  assert.equal(await db.sync_outbox.count(), 0)
})

test('older realtime updates and physical removals cannot roll back clean content', async () => {
  await mergeRemoteNote(remoteNote({ updatedAt: future }))
  assert.equal(await mergeRemoteNote(remoteNote()), false)
  assert.equal(await mergeRemoteNote(remoteNote(), 'removed'), false)
  assert.equal((await db.notes.get('note-1')).updated_at, future)
})

test('a queue write failure rolls back the note save', async t => {
  await mergeRemoteNote(remoteNote())
  t.mock.method(db.sync_outbox, 'add', async () => { throw new Error('queue write failed') })
  await assert.rejects(save('note-1', 'Must roll back'), /queue write failed/)
  assert.equal((await db.notes.get('note-1')).title, 'Desktop title')
})

test('an edit during a local save stays protected until its own save completes', async () => {
  await mergeRemoteNote(remoteNote())
  let started
  let release
  const saveStarted = new Promise(resolve => { started = resolve })
  noteDrafts.schedule({ id: 'note-1', title: 'First' }, async note => {
    started()
    await new Promise(resolve => { release = resolve })
    await save(note.id, note.title)
  })
  const saving = noteDrafts.flush('note-1')
  await saveStarted
  noteDrafts.schedule({ id: 'note-1', title: 'Second' }, note => save(note.id, note.title))
  release()
  await saving
  assert.equal(noteDrafts.get('note-1').title, 'Second')
  assert.equal(await mergeRemoteNote(remoteNote({ updatedAt: future })), false)
  await noteDrafts.flushAll()
  assert.equal((await db.notes.get('note-1')).title, 'Second')
})

test('sync service serializes overlapping pushes and schedules changes left in flight', async t => {
  await mergeRemoteNote(remoteNote())
  await save('note-1', 'First')
  let started
  let release
  let uploads = 0
  const uploadStarted = new Promise(resolve => { started = resolve })
  t.mock.method(syncService, '_uploadRecord', async () => {
    uploads++
    started()
    await new Promise(resolve => { release = resolve })
  })
  const user = { uid: 'test-user' }
  syncService.currentUser = user
  const first = syncService.pushOutbox(user)
  await uploadStarted
  const second = syncService.pushOutbox(user)
  await save('note-1', 'Second')
  release()
  await Promise.all([first, second])
  assert.equal(uploads, 1)
  assert.equal(await db.sync_outbox.count(), 1)
  assert.ok(syncService._pushTimeout)
})

test('sync service reports upload failure and clears the error after successful retry', async t => {
  await mergeRemoteNote(remoteNote())
  await save('note-1', 'Retry draft')
  let fail = true
  t.mock.method(syncService, '_uploadRecord', async () => {
    if (fail) throw new Error('network failure')
  })
  const user = { uid: 'test-user' }
  await assert.rejects(syncService.pushOutbox(user), /network failure/)
  assert.equal(syncService.getSyncState().status, 'error')
  assert.equal(syncService.getSyncState().outboxCount, 1)
  fail = false
  await syncService.pushOutbox(user)
  assert.equal(syncService.getSyncState().error, null)
  assert.equal(syncService.getSyncState().outboxCount, 0)
})

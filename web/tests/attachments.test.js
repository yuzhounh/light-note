import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { LightNoteDatabase } from '../src/core/db/database.js'
import { findAttachmentCloudPath } from '../src/core/sync/attachmentPaths.js'

const database = new LightNoteDatabase()
after(() => database.delete())

test('existing APK attachments upgrade without losing records and resolve desktop paths', async () => {
  const legacy = new Dexie('LightNoteDB')
  legacy.version(2).stores({
    notebooks: 'id, name, group_id, sort_order, updated_at, deleted_at',
    notes: 'id, notebook_id, title, is_pinned, is_deleted, sort_order, updated_at, deleted_at',
    tags: 'id, name', note_tags: '[note_id+tag_id], note_id, tag_id',
    attachments: 'sha256, filename, byte_size, created_at',
    sync_outbox: '++id, entity_type, entity_id, action, created_at',
    settings: 'key', note_versions: 'id, note_id, created_at'
  })
  await legacy.attachments.put({ sha256: 'hash', relative_path: '68\\hash.png', cloud_path: 'users/user/attachments/hash/hash.png' })
  await legacy.notes.put({ id: 'existing-note', title: 'Preserved note' })
  legacy.close()
  await database.open()
  assert.equal(await database.attachments.count(), 1)
  assert.equal((await database.notes.get('existing-note')).title, 'Preserved note')
  assert.equal((await database.attachments.get('hash')).relative_path, '68/hash.png')
  assert.equal(await findAttachmentCloudPath(database.attachments, 'https://lightnote.attachments/68/hash.png', 'user'), 'users/user/attachments/hash/hash.png')
  assert.equal(await findAttachmentCloudPath(database.attachments, 'https://lightnote.attachments/68\\hash.png', 'user'), 'users/user/attachments/hash/hash.png')
})

test('missing attachment metadata uses the same Storage path as desktop uploads', async () => {
  assert.equal(await findAttachmentCloudPath(database.attachments, 'https://lightnote.attachments/ab/missing.png', 'user'), 'users/user/attachments/missing/missing.png')
})

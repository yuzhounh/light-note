import 'fake-indexeddb/auto'
import { test, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { Timestamp } from 'firebase/firestore'
import { db } from '../src/core/db/database.js'
import { NotesRepository } from '../src/core/db/notesRepository.js'
import { importBackup } from '../src/core/db/backup.js'
import { noteDrafts } from '../src/core/sync/noteDrafts.js'
import { syncService } from '../src/core/sync/syncService.js'
import { cursorKey, deferredKey, newestCursor } from '../src/core/sync/syncCursor.js'

const old = '2026-01-01T00:00:00.000Z'
const future = '2099-01-01T00:00:00.000Z'
const note = (id, seconds, fields = {}) => ({ id, title: id, bodyHtml: '<p>body</p>', bodyText: 'body', bodyJson: '{}',
  createdAt: old, updatedAt: old, deletedAt: null, purgedAt: null, version: 1,
  ...(seconds === null ? {} : { serverUpdatedAt: new Timestamp(seconds, 0) }), ...fields })
const compare = (a, b) => {
  if (a === b) return 0
  if (a == null) return -1
  if (b == null) return 1
  if (typeof a === 'string') return Buffer.compare(Buffer.from(a), Buffer.from(b))
  return a.seconds - b.seconds || a.nanoseconds - b.nanoseconds
}
const rowSnapshot = records => {
  const docs = records.map(record => ({ id: record.id, data: () => structuredClone(record) }))
  return { docs, metadata: { fromCache: false, hasPendingWrites: false }, forEach: fn => docs.forEach(fn),
    docChanges: () => docs.map(doc => ({ type: 'modified', doc })) }
}

function cloud(t, records = []) {
  const data = { notes: new Map(records.map(record => [record.id, record])), notebooks: new Map(), attachments: new Map() }
  const requests = [], points = [], watches = []
  t.mock.method(syncService, '_getServices', () => ({ firestore: {} }))
  const api = syncService._firebase
  t.mock.method(api, 'collection', (_db, _users, uid, kind) => ({ uid, kind }))
  t.mock.method(api, 'doc', (_db, _users, uid, kind, id) => ({ uid, kind, id }))
  t.mock.method(api, 'query', (target, ...constraints) => ({ ...target, constraints }))
  t.mock.method(api, 'documentId', () => '__name__')
  for (const method of ['where', 'orderBy', 'startAfter', 'limit']) t.mock.method(api, method, (...values) => ({ method, values }))
  t.mock.method(api, 'getDocs', async target => {
    const constraints = target.constraints || []
    const orders = constraints.filter(c => c.method === 'orderBy').map(c => c.values)
    const field = (row, name) => name === '__name__' ? row.id : row[name]
    let rows = [...data[target.kind].values()].filter(row => orders.every(([name]) => name === '__name__' || Object.hasOwn(row, name)))
    for (const c of constraints.filter(c => c.method === 'where')) {
      const [name, op, value] = c.values
      assert.equal(op, '>='); rows = rows.filter(row => compare(field(row, name), value) >= 0)
    }
    rows.sort((a, b) => { for (const [name, direction] of orders) { const order = compare(field(a, name), field(b, name)); if (order) return direction === 'desc' ? -order : order } return 0 })
    const after = constraints.find(c => c.method === 'startAfter')?.values
    if (after) rows = rows.filter(row => {
      for (let i = 0; i < after.length; i++) { const order = compare(field(row, orders[i][0]), after[i]); if (order) return orders[i][1] === 'desc' ? order < 0 : order > 0 }
      return false
    })
    const size = constraints.find(c => c.method === 'limit')?.values[0]
    if (size) rows = rows.slice(0, size)
    const kind = orders[0]?.[0] === '__name__' ? 'bootstrap' : orders[0]?.[1] === 'desc' ? 'watermark' : 'delta'
    requests.push({ uid: target.uid, collection: target.kind, kind, ids: rows.map(row => row.id), count: rows.length })
    return rowSnapshot(rows)
  })
  t.mock.method(api, 'getDoc', async target => {
    points.push(target); const record = data[target.kind].get(target.id)
    return { id: target.id, metadata: { fromCache: false }, exists: () => !!record, data: () => structuredClone(record) }
  })
  t.mock.method(api, 'onSnapshot', (target, options, callback) => { const item = { target, options, callback, closed: false }; watches.push(item); return () => { item.closed = true } })
  t.mock.method(syncService, '_uploadRecord', async () => { throw new Error('Unexpected upload in read-only fixture') })
  syncService.currentUser = { uid: 'A' }
  return { data, requests, points, watches }
}

beforeEach(async () => {
  for (const id of noteDrafts.entries.keys()) noteDrafts.discard(id)
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear() })
})
afterEach(() => { syncService.setUser(null); for (const id of noteDrafts.entries.keys()) noteDrafts.discard(id) })
after(async () => db.delete())

test('bootstrap includes legacy records in bounded pages, then persisted sync reads only the frontier', async t => {
  const records = Array.from({ length: 501 }, (_, i) => note(`note-${String(i).padStart(4, '0')}`, 1000 + i))
  records.push(note('legacy', null))
  const remote = cloud(t, records)
  await syncService.syncNow()
  assert.equal(await db.notes.count(), 502)
  assert.deepEqual(remote.requests.filter(r => r.collection === 'notes' && r.kind === 'bootstrap').map(r => r.count), [200, 200, 102])
  assert.ok(await db.notes.get('legacy'))
  assert.ok(remote.watches.every(watch => watch.target.constraints.some(c => c.method === 'where')))
  syncService.setUser(null); syncService.currentUser = { uid: 'A' }; remote.requests.length = 0
  await syncService.syncNow()
  assert.equal(remote.requests.filter(r => r.kind === 'bootstrap' || r.kind === 'watermark').length, 0)
  assert.equal(remote.requests.filter(r => r.collection === 'notes').reduce((n, r) => n + r.count, 0), 1)
})

test('incremental pagination preserves a large timestamp tie and later lower document IDs', async t => {
  const remote = cloud(t, [note('legacy', null)])
  await syncService.syncNow()
  for (let i = 0; i < 451; i++) { const record = note(`note-${String(i).padStart(4, '0')}`, 2000); remote.data.notes.set(record.id, record) }
  remote.requests.length = 0
  await syncService.syncNow()
  assert.equal(await db.notes.count(), 452)
  assert.deepEqual(remote.requests.filter(r => r.collection === 'notes').map(r => r.count), [200, 200, 51])
  remote.data.notes.set('000-before-cursor', note('000-before-cursor', 2000))
  await syncService.syncNow()
  assert.ok(await db.notes.get('000-before-cursor'))
  assert.equal(await db.notes.count(), 453)
  const left = { seconds: 1, nanoseconds: 0, id: '\uE000' }, right = { ...left, id: '😀' }
  assert.equal(newestCursor(left, right), right)
})

test('a failed page rolls back data with its checkpoint and resumes after the prior committed page', async t => {
  const remote = cloud(t, Array.from({ length: 450 }, (_, i) => note(`note-${String(i).padStart(4, '0')}`, 1000 + i)))
  let fail = true
  const put = db.settings.put.bind(db.settings)
  t.mock.method(db.settings, 'put', async record => {
    if (fail && record.key === cursorKey('A', 'notes') && record.value.afterId === 'note-0399') throw new Error('checkpoint disk failure')
    return put(record)
  })
  await assert.rejects(syncService.syncNow(), /checkpoint disk failure/)
  assert.equal(await db.notes.count(), 200)
  assert.equal((await db.settings.get(cursorKey('A', 'notes'))).value.afterId, 'note-0199')
  fail = false; remote.requests.length = 0
  await syncService.syncNow()
  assert.equal(await db.notes.count(), 450)
  assert.equal(remote.requests.find(r => r.collection === 'notes' && r.kind === 'bootstrap').ids[0], 'note-0200')
})

test('a deferred draft conflict is fetched again even after the global checkpoint has passed it', async t => {
  const remote = cloud(t, [note('n', 1000)])
  await syncService.syncNow()
  noteDrafts.schedule({ id: 'n', title: 'Typing' }, async () => {})
  remote.data.notes.set('n', note('n', 2000, { title: 'Remote new', updatedAt: future }))
  remote.data.notes.set('z', note('z', 3000))
  await syncService.syncNow()
  assert.equal((await db.notes.get('n')).title, 'n')
  assert.ok(await db.settings.get(deferredKey('A', 'notes', 'n')))
  noteDrafts.discard('n'); remote.requests.length = 0
  await syncService.syncNow()
  assert.ok(!remote.requests.filter(r => r.collection === 'notes').some(r => r.ids.includes('n')))
  assert.equal((await db.notes.get('n')).title, 'Remote new')
  assert.equal(remote.points.at(-1).id, 'n')
  assert.equal(await db.settings.get(deferredKey('A', 'notes', 'n')), undefined)
})

test('deferred data is re-fetched after local upload instead of replaying a stale remote payload', async t => {
  const remote = cloud(t, [note('n', 1000)])
  await syncService.syncNow()
  noteDrafts.schedule({ id: 'n', title: 'Saved local' }, value => NotesRepository.saveNote(value.id,
    { title: value.title, bodyHtml: '<p>local</p>', bodyText: 'local', bodyJson: '{}' }))
  remote.data.notes.set('n', note('n', 2000, { title: 'Older remote conflict', updatedAt: future }))
  await syncService.syncNow(); await noteDrafts.flushAll()
  t.mock.method(syncService, '_uploadRecord', async (_user, _type, id, record) => {
    remote.data.notes.set(id, note(id, 4000, { title: record.title, updatedAt: record.updated_at }))
  })
  await syncService.syncNow()
  assert.equal((await db.notes.get('n')).title, 'Saved local')
  assert.equal(await db.settings.get(deferredKey('A', 'notes', 'n')), undefined)
  assert.equal(await db.sync_outbox.count(), 0)
})

test('cached or pending realtime snapshots cannot advance the checkpoint; an old same-account subscription is ignored', async t => {
  const remote = cloud(t, [note('n', 1000)])
  await syncService.syncNow()
  const watch = remote.watches.findLast(w => w.target.kind === 'notes')
  const snapshot = rowSnapshot([note('n', 2000)])
  await watch.callback({ ...snapshot, metadata: { fromCache: true, hasPendingWrites: false } })
  assert.equal((await db.settings.get(cursorKey('A', 'notes'))).value.cursor.seconds, 1000)
  await watch.callback({ ...snapshot, metadata: { fromCache: false, hasPendingWrites: true } })
  assert.equal((await db.settings.get(cursorKey('A', 'notes'))).value.cursor.seconds, 1000)
  remote.data.notes.set('n', note('n', 2000)); await watch.callback(snapshot)
  assert.equal((await db.settings.get(cursorKey('A', 'notes'))).value.cursor.seconds, 2000)
  await syncService.syncNow()
  await watch.callback(rowSnapshot([note('n', 9999, { title: 'Late old stream', updatedAt: future })]))
  assert.notEqual((await db.notes.get('n')).title, 'Late old stream')
  assert.equal((await db.settings.get(cursorKey('A', 'notes'))).value.cursor.seconds, 2000)
})

test('backup import invalidates the frontier without exporting or deleting user records', async t => {
  const remote = cloud(t, [note('n', 1000)])
  await syncService.syncNow()
  const restored = { ...(await db.notes.get('n')), title: 'Restored older version', updated_at: '2025-01-01T00:00:00Z' }
  await importBackup({ text: async () => JSON.stringify({ notebooks: [], notes: [restored] }) })
  assert.equal((await db.notes.get('n')).title, restored.title)
  assert.equal(await db.settings.get(cursorKey('A', 'notes')), undefined)
  remote.requests.length = 0; await syncService.syncNow()
  assert.ok(remote.requests.some(r => r.collection === 'notes' && r.kind === 'bootstrap'))
  assert.equal((await db.notes.get('n')).title, 'n')
})

test('switching the shared cache owner forces a new bootstrap and returning also rebuilds its frontier', async t => {
  const remote = cloud(t, [note('n', 1000)])
  await syncService.syncNow()
  syncService.setUser(null); syncService.currentUser = { uid: 'B' }; remote.requests.length = 0
  await syncService.syncNow()
  assert.ok(remote.requests.some(r => r.uid === 'B' && r.collection === 'notes' && r.kind === 'bootstrap'))
  assert.equal(await db.settings.get(cursorKey('A', 'notes')), undefined)
  syncService.setUser(null); syncService.currentUser = { uid: 'A' }; remote.requests.length = 0
  await syncService.syncNow()
  assert.ok(remote.requests.some(r => r.uid === 'A' && r.collection === 'notes' && r.kind === 'bootstrap'))
})

test('attachment bootstrap failure retains increasing retry backoff while notes remain usable', async t => {
  cloud(t, [note('n', 1000)])
  const getDocs = syncService._firebase.getDocs
  t.mock.method(console, 'warn', () => {})
  t.mock.method(syncService._firebase, 'getDocs', target => {
    if (target.kind === 'attachments') throw Object.assign(new Error('temporary unavailable'), { code: 'unavailable' })
    return getDocs(target)
  })
  await syncService.syncNow(); assert.equal(syncService._pullFailures, 1)
  await syncService.syncNow(); assert.equal(syncService._pullFailures, 2)
  assert.ok(await db.notes.get('n'))
})

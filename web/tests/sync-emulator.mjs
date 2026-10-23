// Run only with Firebase emulators:exec --project demo-lightnote-perf.
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { initializeApp, deleteApp } from 'firebase/app'
import { getFirestore, connectFirestoreEmulator, collection, doc, writeBatch, setDoc,
  getDocFromServer, serverTimestamp, Timestamp, terminate } from 'firebase/firestore'
import { db } from '../src/core/db/database.js'
import { syncService } from '../src/core/sync/syncService.js'
import { cursorKey } from '../src/core/sync/syncCursor.js'

const projectId = 'demo-lightnote-perf'
assert.equal(process.env.GCLOUD_PROJECT, projectId, 'Use the isolated demo project')
const endpoint = process.env.FIRESTORE_EMULATOR_HOST
assert.match(endpoint || '', /^127\.0\.0\.1:8187$/, 'The local emulator must be running')
const app = initializeApp({ projectId, apiKey: 'emulator-only', appId: 'emulator-only' }, 'perf-fixture')
const firestore = getFirestore(app)
connectFirestoreEmulator(firestore, '127.0.0.1', 8187)
const uid = 'fixture-user'
const reference = kind => collection(firestore, 'users', uid, kind)
const at = '2026-01-01T00:00:00.000Z'
const note = (title, stamp) => ({ title, bodyHtml: '<p>fixture</p>', bodyText: 'fixture',
  bodyJson: '{}', createdAt: at, updatedAt: at, deletedAt: null, purgedAt: null, version: 1,
  ...(stamp ? { serverUpdatedAt: stamp } : {}) })
const sizes = []
const realGetDocs = syncService._firebase.getDocs
syncService._getServices = () => ({ firestore })
syncService._firebase.getDocs = async target => {
  const snapshot = await realGetDocs(target)
  sizes.push({ collection: target._query.path.lastSegment(), count: snapshot.size })
  assert.ok(snapshot.size <= 200, 'Every paged pull stays within 200 documents')
  return snapshot
}
const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  throw new Error(`Timed out: ${label}`)
}

try {
  const batch = writeBatch(firestore)
  for (let i = 0; i < 451; i++) batch.set(doc(reference('notes'), `note-${String(i).padStart(4, '0')}`),
    note(`Note ${i}`, Timestamp.fromMillis(Date.parse(at) + i * 1000)))
  batch.set(doc(reference('notes'), 'legacy'), note('Legacy without server timestamp'))
  batch.set(doc(reference('notebooks'), 'book'), { name: 'Fixture', createdAt: at, updatedAt: at,
    serverUpdatedAt: Timestamp.fromMillis(Date.parse(at)) })
  const sha256 = 'a'.repeat(64)
  batch.set(doc(reference('attachments'), sha256), { sha256, filename: 'fixture.png', relativePath: 'fixture.png',
    size: 123, createdAt: at, updatedAt: at, serverUpdatedAt: Timestamp.fromMillis(Date.parse(at)) })
  await batch.commit()
  syncService.currentUser = { uid }
  await syncService.syncNow()
  assert.equal(await db.notes.count(), 452)
  assert.equal((await db.notes.get('legacy')).title, 'Legacy without server timestamp')
  assert.equal((await db.notebooks.get('book')).name, 'Fixture')
  assert.equal((await db.attachments.get(sha256)).byte_size, 123)
  assert.equal((await db.settings.get(cursorKey(uid, 'notes'))).value.phase, 'incremental')
  const firstPull = sizes.splice(0)
  assert.deepEqual(firstPull.filter(row => row.collection === 'notes').map(row => row.count), [1, 200, 200, 52, 1])

  syncService.setUser(null)
  syncService.currentUser = { uid }
  await syncService.syncNow()
  const reopenedPull = sizes.splice(0)
  assert.deepEqual(reopenedPull.filter(row => row.collection === 'notes').map(row => row.count), [1])

  await setDoc(doc(reference('notes'), 'zz-live'), { ...note('Realtime note'),
    updatedAt: new Date().toISOString(), serverUpdatedAt: serverTimestamp() })
  await waitFor(async () => (await db.notes.get('zz-live'))?.title === 'Realtime note', 'real note listener')
  const notebookUpdate = new Date().toISOString()
  await setDoc(doc(reference('notebooks'), 'book'), { name: 'Realtime notebook', updatedAt: notebookUpdate,
    serverUpdatedAt: serverTimestamp() }, { merge: true })
  await setDoc(doc(reference('attachments'), sha256), { filename: 'renamed.png', updatedAt: notebookUpdate,
    serverUpdatedAt: serverTimestamp() }, { merge: true })
  await waitFor(async () => (await db.notebooks.get('book'))?.name === 'Realtime notebook', 'real notebook listener')
  await waitFor(async () => (await db.attachments.get(sha256))?.filename === 'renamed.png', 'real attachment listener')

  await syncService.syncNow()
  const checkpoint = (await db.settings.get(cursorKey(uid, 'notes'))).value.cursor
  const live = await getDocFromServer(doc(reference('notes'), 'zz-live'))
  const sharedStamp = live.data().serverUpdatedAt
  assert.equal(checkpoint.seconds, sharedStamp.seconds)
  assert.equal(checkpoint.nanoseconds, sharedStamp.nanoseconds)
  syncService.stopRealtimeSync()
  await setDoc(doc(reference('notes'), 'aa-late'), note('Later lower ID at same timestamp', sharedStamp))
  await syncService.syncNow()
  assert.equal((await db.notes.get('aa-late')).title, 'Later lower ID at same timestamp')
  assert.equal(await db.notes.count(), 454)
  assert.equal(await db.sync_outbox.count(), 0)
  const receipt = { projectId, emulatorOnly: true, sdk: 'firebase 12.19.0',
    firstNotesPullDocuments: firstPull.filter(row => row.collection === 'notes').map(row => row.count),
    reopenedNotesPullDocuments: reopenedPull.filter(row => row.collection === 'notes').map(row => row.count),
    pagedPullLimit: 200, notes: 454, legacyIncluded: true, realtimeNotesNotebooksAttachments: true,
    sameTimestampLowerIdIncluded: true, productionAccess: false, completedAt: new Date().toISOString() }
  const results = new URL('../../results/', import.meta.url)
  await mkdir(results, { recursive: true })
  await writeFile(new URL('sync-emulator-verification.json', results), JSON.stringify(receipt, null, 2) + '\n')
  console.log(JSON.stringify(receipt))
} finally {
  syncService.setUser(null)
  syncService._firebase.getDocs = realGetDocs
  await terminate(firestore)
  await deleteApp(app)
  await db.delete()
}

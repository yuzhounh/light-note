import { 
  getFirestore, 
  initializeFirestore,
  collection, 
  doc, 
  getDocsFromServer as getDocs,
  setDoc,
  writeBatch,
  onSnapshot,
  query, where, orderBy, startAfter, limit, documentId, getDocFromServer,
} from 'firebase/firestore'
import { getStorage, ref, getDownloadURL } from 'firebase/storage'
import { initFirebase } from '../auth/firebaseAuth.js'
import { db } from '../db/database.js'
import { mergeRemoteNote, mergeRemoteNotebook, pushPendingChanges, toIsoString } from './syncStore.js'
import { buildSyncPayload } from './syncPayload.js'
import { noteDrafts } from './noteDrafts.js'
import { ATTACHMENT_URL_PREFIX, findAttachmentCloudPath, normalizeAttachmentPath } from './attachmentPaths.js'
import { Capacitor } from '@capacitor/core'
import { cachedImageUrl, releaseImageUrls } from './imageCache.js'
import { cursorKey, deferredKey, deferredPrefix, deltaQuery, documentCursor, newestCursor,
  prepareDownloadOwner, assertDownloadEpoch, pullCollection } from './syncCursor.js'

const usesPersistentImageCache = Capacitor.getPlatform() === 'android'

let firestoreInstance = null
let storageInstance = null

function getServices() {
  if (!firestoreInstance) {
    const app = initFirebase()
    // Android WebView connections can be buffered by the phone's proxy.
    // Close each response after data arrives instead of holding a stream open.
    firestoreInstance = Capacitor.getPlatform() === 'android'
      ? initializeFirestore(app, { experimentalForceLongPolling: true })
      : getFirestore(app)
    storageInstance = getStorage(app)
  }
  return { firestore: firestoreInstance, storage: storageInstance }
}

const syncState = {
  status: 'idle', // 'idle' | 'syncing' | 'synced' | 'error'
  lastSyncedAt: null,
  error: null,
  outboxCount: 0
}

const listeners = new Set()

function notifyListeners() {
  for (const listener of listeners) {
    try {
      listener({ ...syncState })
    } catch (e) {
      console.error('Sync listener error:', e)
    }
  }
}

export function subscribeSyncState(callback) {
  listeners.add(callback)
  callback({ ...syncState })
  return () => listeners.delete(callback)
}

export function getSyncState() {
  return { ...syncState }
}

// In-memory cache for storage download URLs: relativePath -> downloadUrl
const attachmentUrlCache = new Map()

const DEMO_TITLES = new Set([
  '具身智能',
  'AI 模型发布日报 | 9月24日',
  '开发计划',
  'V1.6: 交互细节统一',
  'TypeScript 5.8 新特性速览',
  '每周复盘模板'
])

class SyncCancelledError extends Error {
  constructor() { super('同步账户已经改变'); this.name = 'SyncCancelledError' }
}

export const syncService = {
  getSyncState,
  currentUser: null,
  _unsubscribeSnapshots: null,
  _pushTimeout: null,
  _isSyncing: false,
  _generation: 0,
  _syncPromise: null,
  _syncSession: null,
  _pushPromise: null,
  _pushSession: null,
  _snapshotEpoch: 0,
  _pullRetryTimeout: null,
  _pullFailures: 0,
  _listenCursors: new Map(),
  _getServices: getServices,
  _firebase: { collection, getDocs, onSnapshot, query, where, orderBy, startAfter, limit, documentId, doc, getDoc: getDocFromServer },

  onDataChange: null,

  setUser(user, onDataChange = null) {
    if (onDataChange) this.onDataChange = onDataChange
    const prevUid = this.currentUser?.uid
    const nextUid = user?.uid
    this.currentUser = user

    if (prevUid !== nextUid) {
      this._generation++
      this.stopRealtimeSync()
      this._listenCursors.clear()
      this._pullFailures = 0
      attachmentUrlCache.clear()
      releaseImageUrls()
      syncState.status = 'idle'
      syncState.error = null
      syncState.lastSyncedAt = null
      notifyListeners()
      if (nextUid) {
        this.syncNow(user, this.onDataChange).catch(err => {
          console.warn('Initial sync error:', err)
        })
      } else {
        syncState.status = 'idle'
        syncState.error = null
        notifyListeners()
      }
    }
  },

  _session(user) { return { uid: user?.uid, generation: this._generation } },
  _isCurrent(session) {
    return !!session.uid && this.currentUser?.uid === session.uid && this._generation === session.generation
  },
  _assertCurrent(session) {
    if (!this._isCurrent(session)) throw new SyncCancelledError()
  },
  _sameSession(left, right) {
    return left?.uid === right.uid && left?.generation === right.generation
  },
  async _applyRemote(session, apply, snapshotEpoch = null) {
    const assert = () => {
      this._assertCurrent(session)
      if (snapshotEpoch !== null && snapshotEpoch !== this._snapshotEpoch) throw new SyncCancelledError()
    }
    return db.transaction('rw', db.notes, db.notebooks, db.attachments, db.sync_outbox, db.settings, async () => {
      assert()
      const result = await apply()
      // Roll back the whole local transaction if the account changed during a merge.
      assert()
      return result
    })
  },

  notifyOutboxChanged(delay = 1500) {
    if (!this.currentUser) return
    if (this._pushTimeout) clearTimeout(this._pushTimeout)
    this._pushTimeout = setTimeout(() => {
      if (this._isSyncing) { this.notifyOutboxChanged(delay); return }
      this.pushOutbox(this.currentUser).catch(err => {
        console.warn('Auto-push outbox failed:', err)
      })
    }, delay)
  },

  /**
   * Main sync method: Pushes local outbox and pulls latest from Firestore
   */
  async syncNow(user = this.currentUser, onDataChange = null) {
    if (!user || !user.uid) return
    const session = this._session(user)
    if (!this._isCurrent(session)) return
    if (this._syncPromise) {
      if (this._sameSession(this._syncSession, session)) return this._syncPromise
      await this._syncPromise.catch(() => {})
      if (!this._isCurrent(session)) return
      return this.syncNow(user, onDataChange)
    }
    clearTimeout(this._pullRetryTimeout)
    this._pullRetryTimeout = null
    const job = this._pullAndPush(user, session, onDataChange)
    this._syncPromise = job
    this._syncSession = session
    try { return await job }
    finally {
      if (this._syncPromise === job) {
        this._syncPromise = null
        this._syncSession = null
      }
    }
  },

  async _mergeEntity(session, kind, record, type = 'modified', clearDeferred = false) {
    let blocked = false, changed = false
    if (kind === 'notes') changed = await mergeRemoteNote(record, type, () => { blocked = true })
    else if (kind === 'notebooks') changed = await mergeRemoteNotebook(record, type, () => { blocked = true })
    else if (kind === 'attachments' && type !== 'removed') {
      const previous = await db.attachments.get(record.sha256 || '')
      const fields = {
        id: record.id, sha256: record.sha256 || '', filename: record.filename || '',
        cloud_path: record.cloudPath || '', relative_path: normalizeAttachmentPath(record.relativePath),
        byte_size: record.size || 0, mime_type: record.mimeType || 'image/png',
        created_at: toIsoString(record.createdAt, previous?.created_at || new Date().toISOString()),
        updated_at: toIsoString(record.updatedAt, previous?.updated_at || null),
        deleted_at: toIsoString(record.deletedAt, null)
      }
      if (!previous || Object.keys(fields).some(key => previous[key] !== fields[key])) {
        await db.attachments.put({ ...previous, ...fields }); changed = true
      }
    }
    const key = deferredKey(session.uid, kind, record.id)
    if (blocked) await db.settings.put({ key, value: { kind, id: record.id } })
    else if (clearDeferred) await db.settings.delete(key)
    return changed
  },

  async _pullCollection(user, session, kind, epoch, callback) {
    const { firestore } = this._getServices()
    const reference = this._firebase.collection(firestore, 'users', user.uid, kind)
    return pullCollection({ api: this._firebase, reference, uid: user.uid, kind, epoch,
      assertCurrent: () => this._assertCurrent(session),
      commitPage: async (records, key, state, fullIds) => {
        const changed = await this._applyRemote(session, async () => {
          await assertDownloadEpoch(epoch)
          let changed = false
          for (const record of records) changed = await this._mergeEntity(session, kind, record) || changed
          if (kind === 'notes' && fullIds !== null) await this._cleanDemoNotes(fullIds)
          await db.settings.put({ key, value: state })
          return changed
        })
        if ((changed || fullIds !== null) && this._isCurrent(session)) callback?.()
      }
    })
  },

  async _retryDeferred(user, session, epoch) {
    const entries = await db.settings.where('key').startsWith(deferredPrefix(user.uid)).toArray()
    const { firestore } = this._getServices()
    for (const entry of entries) {
      this._assertCurrent(session)
      const { kind, id } = entry.value
      if (!['notes', 'notebooks', 'attachments'].includes(kind)) throw new Error('同步记录类型无效')
      if (kind === 'notes' && noteDrafts.has(id)) continue
      const entityType = kind === 'notes' ? 'note' : 'notebook'
      if (await db.sync_outbox.where('entity_type').equals(entityType).and(item => item.entity_id === id).count()) continue
      // Re-fetch the current document after upload acknowledgement; an old deferred payload
      // must not replace a newer local upload or a later server revision.
      const snapshot = await this._firebase.getDoc(this._firebase.doc(firestore, 'users', user.uid, kind, id))
      this._assertCurrent(session)
      if (snapshot.metadata?.fromCache || snapshot.metadata?.hasPendingWrites) throw new Error('尚未从云端取得最新记录，请检查网络后下拉重试')
      await this._applyRemote(session, async () => {
        await assertDownloadEpoch(epoch)
        if (!snapshot.exists()) await db.settings.delete(entry.key) // physical removal remains non-destructive locally
        else await this._mergeEntity(session, kind, { ...snapshot.data(), id: snapshot.id }, 'modified', true)
      })
    }
  },

  _schedulePullRetry(session, error, callback) {
    const code = String(error?.code || '').split('/').at(-1)
    if (!this._isCurrent(session) || this._pullRetryTimeout ||
      ['permission-denied', 'unauthenticated', 'failed-precondition', 'invalid-argument'].includes(code) ||
      (typeof navigator !== 'undefined' && navigator.onLine === false)) return
    const delay = Math.min(60000, 5000 * 2 ** Math.min(this._pullFailures++, 4))
    this._pullRetryTimeout = setTimeout(() => {
      this._pullRetryTimeout = null
      if (this._isCurrent(session)) this.syncNow(this.currentUser, callback).catch(error => console.warn('Sync retry failed:', error))
    }, delay)
  },

  async _pullAndPush(user, session, onDataChange) {
    this._isSyncing = true
    this.stopRealtimeSync({ preservePush: true, preserveRetry: true })
    syncState.status = 'syncing'; syncState.error = null
    notifyListeners()
    let failure = null, attachmentFailure = null
    const callback = onDataChange || this.onDataChange
    try {
      if (this._pushPromise && this._sameSession(this._pushSession, session)) await this._pushPromise.catch(() => {})
      this._assertCurrent(session)
      const epoch = await prepareDownloadOwner(user.uid, () => this._assertCurrent(session))
      const notebooks = await this._pullCollection(user, session, 'notebooks', epoch, callback)
      const notes = await this._pullCollection(user, session, 'notes', epoch, callback)
      try { await this._pullCollection(user, session, 'attachments', epoch, callback) }
      catch (error) { this._assertCurrent(session); attachmentFailure = error; console.warn('Sync attachments skipped:', error) }
      this._assertCurrent(session)
      await assertDownloadEpoch(epoch)
      await this.pushOutbox(user)
      await this._retryDeferred(user, session, epoch)
      await assertDownloadEpoch(epoch)
      const count = await db.sync_outbox.count()
      this._assertCurrent(session)
      syncState.outboxCount = count
      syncState.status = 'synced'; syncState.lastSyncedAt = new Date().toISOString(); syncState.error = null
      if (!attachmentFailure) this._pullFailures = 0
      notifyListeners(); callback?.()
      return { remoteNotebooksCount: notebooks.documents, remoteNotesCount: notes.documents }
    } catch (error) {
      if (error instanceof SyncCancelledError || !this._isCurrent(session)) return
      failure = error
      syncState.status = 'error'; syncState.error = error.message || '同步失败'
      notifyListeners()
      throw error
    } finally {
      this._isSyncing = false
      if (this._isCurrent(session)) {
        try {
          const ready = await this.startRealtimeSync(user, callback)
          if (failure || !ready) this._schedulePullRetry(session, failure || attachmentFailure, callback)
        } catch (error) { this._schedulePullRetry(session, error, callback) }
      }
    }
  },

  /**
   * Push local outbox queue to Firestore
   */
  async pushOutbox(user = this.currentUser) {
    if (!user || !user.uid) return
    const session = this._session(user)
    if (!this._isCurrent(session)) return
    if (this._pushPromise) {
      if (this._sameSession(this._pushSession, session)) return this._pushPromise
      await this._pushPromise.catch(() => {})
      if (!this._isCurrent(session)) return
      return this.pushOutbox(user)
    }
    const job = (async () => {
      try {
        await pushPendingChanges((entityType, id, record) => this._uploadRecord(user, entityType, id, record),
          () => this._assertCurrent(session), entries => this._uploadBatch(user, entries))
        this._assertCurrent(session)
        if (!this._isSyncing) {
          syncState.status = 'synced'
          syncState.error = null
          syncState.lastSyncedAt = new Date().toISOString()
        }
      } catch (err) {
        if (err instanceof SyncCancelledError || !this._isCurrent(session)) return
        syncState.status = 'error'
        syncState.error = err.message || '上传失败'
        throw err
      } finally {
        const count = await db.sync_outbox.count()
        if (this._isCurrent(session)) {
          syncState.outboxCount = count
          notifyListeners()
        }
      }
    })()
    this._pushPromise = job
    this._pushSession = session
    try {
      await job
    } finally {
      if (this._pushPromise === job) {
        this._pushPromise = null
        this._pushSession = null
      }
      if (this._isCurrent(session) && syncState.outboxCount) this.notifyOutboxChanged(syncState.error ? 15000 : 1500)
    }
  },

  async _uploadRecord(user, entityType, id, record) {
    const { firestore } = this._getServices()
    const document = doc(firestore, 'users', user.uid,
      entityType === 'note' ? 'notes' : 'notebooks', id)
    await setDoc(document, buildSyncPayload(entityType, record), { merge: true })
  },

  async _uploadBatch(user, entries) {
    const { firestore } = this._getServices()
    const batch = writeBatch(firestore)
    for (const { entityType, id, record } of entries) {
      batch.set(doc(firestore, 'users', user.uid, entityType === 'note' ? 'notes' : 'notebooks', id),
        buildSyncPayload(entityType, record), { merge: true })
    }
    await batch.commit()
  },

  /**
   * Listen for real-time Firestore updates and keep local Dexie in sync
   */
  async startRealtimeSync(user = this.currentUser, onDataChange = null) {
    if (!user?.uid) return false
    this.stopRealtimeSync({ preservePush: true, preserveRetry: true })
    const session = this._session(user), epoch = this._snapshotEpoch
    if (!this._isCurrent(session)) return false
    const { firestore } = this._getServices()
    const unsubscribers = []
    this._unsubscribeSnapshots = () => { for (const unsubscribe of unsubscribers.splice(0)) unsubscribe() }
    let ready = true
    for (const kind of ['notebooks', 'notes', 'attachments']) {
      const state = (await db.settings.get(cursorKey(user.uid, kind)))?.value
      if (!this._isCurrent(session) || epoch !== this._snapshotEpoch) { for (const unsubscribe of unsubscribers.splice(0)) unsubscribe(); return false }
      if (state?.phase === 'incremental') this._listenCursors.set(kind, state.cursor)
      else ready = false
      const cursor = state?.phase === 'incremental' ? state.cursor : this._listenCursors.get(kind)
      if (!cursor) continue // first bootstrap owns the initial load, avoiding a second full listener read
      const reference = this._firebase.collection(firestore, 'users', user.uid, kind)
      unsubscribers.push(this._firebase.onSnapshot(deltaQuery(this._firebase, reference, cursor),
        { includeMetadataChanges: true },
        snapshot => this._processSnapshot(session, epoch, kind, snapshot, onDataChange),
        error => { if (this._isCurrent(session) && epoch === this._snapshotEpoch) console.warn(`Realtime ${kind} listener warning:`, error) }))
    }
    return ready
  },

  async _processSnapshot(session, epoch, kind, snapshot, onDataChange) {
    if (!this._isCurrent(session) || epoch !== this._snapshotEpoch) return
    try {
      let committedCursor = null
      const changed = await this._applyRemote(session, async () => {
        let changed = false
        const changes = snapshot.docChanges()
        for (const change of changes) changed = await this._mergeEntity(session, kind,
          { ...change.doc.data(), id: change.doc.id }, change.type) || changed
        if (!snapshot.metadata?.fromCache && !snapshot.metadata?.hasPendingWrites) {
          const key = cursorKey(session.uid, kind), checkpoint = await db.settings.get(key)
          if (checkpoint?.value.phase === 'incremental') {
            let cursor = checkpoint.value.cursor
            const documents = snapshot.docs || changes.filter(change => change.type !== 'removed').map(change => change.doc)
            for (const document of documents) cursor = newestCursor(cursor, documentCursor({ ...document.data(), id: document.id }))
            if (cursor !== checkpoint.value.cursor || checkpoint.value.delta) {
              await db.settings.put({ key, value: { ...checkpoint.value, cursor, delta: null } })
            }
            committedCursor = cursor
          }
        }
        return changed
      }, epoch)
      if (committedCursor && this._isCurrent(session) && epoch === this._snapshotEpoch) this._listenCursors.set(kind, committedCursor)
      const callback = onDataChange || this.onDataChange
      if (changed && this._isCurrent(session) && epoch === this._snapshotEpoch) callback?.()
    } catch (error) {
      if (!(error instanceof SyncCancelledError) && this._isCurrent(session) && epoch === this._snapshotEpoch) {
        syncState.status = 'error'; syncState.error = error.message || '同步失败'; notifyListeners()
      }
    }
  },

  stopRealtimeSync({ preservePush = false, preserveRetry = false } = {}) {
    this._snapshotEpoch++
    if (!preservePush) { clearTimeout(this._pushTimeout); this._pushTimeout = null }
    if (!preserveRetry) { clearTimeout(this._pullRetryTimeout); this._pullRetryTimeout = null }
    if (this._unsubscribeSnapshots) { this._unsubscribeSnapshots(); this._unsubscribeSnapshots = null }
  },

  /**
   * Resolve an image source URL.
   * If it's `https://lightnote.attachments/{relPath}`, fetches a signed download URL from Firebase Storage.
   */
  async resolveImageUrl(src, user = this.currentUser) {
    if (usesPersistentImageCache) {
      try { return await cachedImageUrl(src || '', user?.uid, () => this.resolveDownloadUrl(src, user)) }
      catch (error) { console.warn('图片缓存加载失败:', error); return src }
    }
    return this.resolveDownloadUrl(src, user)
  },

  async resolveDownloadUrl(src, user = this.currentUser) {
    if (!src || !src.startsWith(ATTACHMENT_URL_PREFIX)) {
      return src
    }

    const uid = user?.uid

    if (!uid) return src
    const session = this._session(user)
    const cacheKey = `${uid}:${src}`
    if (!this._isCurrent(session)) return src
    if (attachmentUrlCache.has(cacheKey)) return attachmentUrlCache.get(cacheKey)

    try {
      const { storage } = getServices()
      const cloudPath = await findAttachmentCloudPath(db.attachments, src, uid)
      this._assertCurrent(session)
      const storageRef = ref(storage, cloudPath)
      const downloadUrl = await getDownloadURL(storageRef)
      this._assertCurrent(session)
      attachmentUrlCache.set(cacheKey, downloadUrl)
      return downloadUrl
    } catch (err) {
      if (err instanceof SyncCancelledError) return src
      console.warn(`Could not resolve attachment URL for ${src}:`, err)
      return src
    }
  },

  /**
   * Helper to clean initial unedited demo notes once remote notes are pulled
   */
  async _cleanDemoNotes(remoteNoteIds) {
    const remoteIdSet = new Set(remoteNoteIds)
    const localNotes = await db.notes.toArray()
    const outbox = await db.sync_outbox.toArray()
    const outboxNoteIds = new Set(outbox.filter(o => o.entity_type === 'note').map(o => o.entity_id))

    for (const note of localNotes) {
      // If it's a seeded demo note (marked or matches title) and has not been edited by user and is not on remote
      const isDemo = note.is_demo === 1 ||
        (DEMO_TITLES.has(note.title) && note.created_at?.includes('2026-09-25T10:02'))
      if (isDemo && !noteDrafts.has(note.id) && !outboxNoteIds.has(note.id) && !remoteIdSet.has(note.id)) {
        await db.notes.delete(note.id)
      }
    }

    // Clean empty demo notebooks if they don't exist on remote
    const localNotebooks = await db.notebooks.toArray()
    for (const nb of localNotebooks) {
      if (nb.is_demo === 1) {
        const remaining = await db.notes.where('notebook_id').equals(nb.id).count()
        if (remaining === 0) {
          await db.notebooks.delete(nb.id)
        }
      }
    }
  }
}

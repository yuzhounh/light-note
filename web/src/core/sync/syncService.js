import { 
  getFirestore, 
  collection, 
  doc, 
  getDocs, 
  setDoc, 
  onSnapshot, 
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

const usesPersistentImageCache = Capacitor.getPlatform() === 'android'

let firestoreInstance = null
let storageInstance = null

function getServices() {
  if (!firestoreInstance) {
    const app = initFirebase()
    firestoreInstance = getFirestore(app)
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
  _getServices: getServices,
  _firebase: { collection, getDocs, onSnapshot },

  onDataChange: null,

  setUser(user, onDataChange = null) {
    if (onDataChange) this.onDataChange = onDataChange
    const prevUid = this.currentUser?.uid
    const nextUid = user?.uid
    this.currentUser = user

    if (prevUid !== nextUid) {
      this._generation++
      this.stopRealtimeSync()
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
        this.startRealtimeSync(user, this.onDataChange)
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
  async _applyRemote(session, apply) {
    return db.transaction('rw', db.notes, db.notebooks, db.attachments, db.sync_outbox, async () => {
      this._assertCurrent(session)
      const result = await apply()
      // Roll back the whole local transaction if the account changed during a merge.
      this._assertCurrent(session)
      return result
    })
  },

  notifyOutboxChanged(delay = 1500) {
    if (!this.currentUser) return
    if (this._pushTimeout) clearTimeout(this._pushTimeout)
    this._pushTimeout = setTimeout(() => {
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

  async _pullAndPush(user, session, onDataChange) {
    this._isSyncing = true
    syncState.status = 'syncing'
    syncState.error = null
    notifyListeners()

    try {
      const { firestore } = this._getServices()
      const uid = user.uid

      // 1. Pull remote notebooks
      const nbColRef = this._firebase.collection(firestore, 'users', uid, 'notebooks')
      const nbSnap = await this._firebase.getDocs(nbColRef)
      this._assertCurrent(session)
      const remoteNotebooks = []
      nbSnap.forEach(d => {
        remoteNotebooks.push({ id: d.id, ...d.data() })
      })

      // 2. Pull remote notes
      const remoteNotes = []
      const notesSnap = await this._firebase.getDocs(this._firebase.collection(firestore, 'users', uid, 'notes'))
      this._assertCurrent(session)
      notesSnap.forEach(d => remoteNotes.push({ id: d.id, ...d.data() }))

      // 3. Pull remote attachments
      const remoteAttachments = []
      try {
        const attColRef = this._firebase.collection(firestore, 'users', uid, 'attachments')
        const attSnap = await this._firebase.getDocs(attColRef)
        this._assertCurrent(session)
        attSnap.forEach(d => {
          remoteAttachments.push({ id: d.id, ...d.data() })
        })
      } catch (e) {
        this._assertCurrent(session)
        console.warn('Sync attachments skipped:', e)
      }

      await this._applyRemote(session, async () => {
        for (const att of remoteAttachments) {
          await db.attachments.put({
            id: att.id, sha256: att.sha256 || '', filename: att.filename || '',
            cloud_path: att.cloudPath || '', relative_path: normalizeAttachmentPath(att.relativePath),
            byte_size: att.size || 0, mime_type: att.mimeType || 'image/png',
            created_at: toIsoString(att.createdAt)
          })
        }
        if (remoteNotes.length > 0 || remoteNotebooks.length > 0) {
          await this._cleanDemoNotes(remoteNotes.map(n => n.id))
        }
        for (const rNb of remoteNotebooks) await mergeRemoteNotebook(rNb)
        for (const rNote of remoteNotes) await mergeRemoteNote(rNote)
      })

      this._assertCurrent(session)
      await this.pushOutbox(user)
      this._assertCurrent(session)

      // Update outbox count
      const remainingOutbox = await db.sync_outbox.count()
      this._assertCurrent(session)
      syncState.outboxCount = remainingOutbox
      syncState.status = 'synced'
      syncState.lastSyncedAt = new Date().toISOString()
      syncState.error = null
      notifyListeners()

      const cb = onDataChange || this.onDataChange
      if (cb) {
        cb()
      }

      return {
        remoteNotebooksCount: remoteNotebooks.length,
        remoteNotesCount: remoteNotes.length
      }
    } catch (err) {
      if (err instanceof SyncCancelledError || !this._isCurrent(session)) return
      console.error('Sync failed:', err)
      syncState.status = 'error'
      syncState.error = err.message || '同步失败'
      notifyListeners()
      throw err
    } finally {
      this._isSyncing = false
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
          () => this._assertCurrent(session))
        this._assertCurrent(session)
        syncState.status = 'synced'
        syncState.error = null
        syncState.lastSyncedAt = new Date().toISOString()
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

  /**
   * Listen for real-time Firestore updates and keep local Dexie in sync
   */
  startRealtimeSync(user = this.currentUser, onDataChange = null) {
    if (!user || !user.uid) return
    this.stopRealtimeSync()

    const session = this._session(user)
    if (!this._isCurrent(session)) return
    const { firestore } = this._getServices()
    const uid = user.uid

    const processSnapshot = async (snapshot, merge) => {
      if (!this._isCurrent(session)) return
      try {
        const changed = await this._applyRemote(session, async () => {
          let changed = false
          for (const change of snapshot.docChanges()) {
            this._assertCurrent(session)
            changed = await merge({ id: change.doc.id, ...change.doc.data() }, change.type) || changed
          }
          return changed
        })
        const callback = onDataChange || this.onDataChange
        if (this._isCurrent(session) && changed && callback) callback()
      } catch (error) {
        if (!(error instanceof SyncCancelledError) && this._isCurrent(session)) {
          syncState.status = 'error'
          syncState.error = error.message || '同步失败'
          notifyListeners()
        }
      }
    }
    const unsubNotes = this._firebase.onSnapshot(this._firebase.collection(firestore, 'users', uid, 'notes'), snapshot => processSnapshot(snapshot, mergeRemoteNote), err => {
      if (!this._isCurrent(session)) return
      console.warn('Realtime notes listener warning:', err)
    })

    const unsubNotebooks = this._firebase.onSnapshot(this._firebase.collection(firestore, 'users', uid, 'notebooks'), snapshot => processSnapshot(snapshot, mergeRemoteNotebook), err => {
      if (!this._isCurrent(session)) return
      console.warn('Realtime notebooks listener warning:', err)
    })

    this._unsubscribeSnapshots = () => {
      unsubNotes()
      unsubNotebooks()
    }
  },

  stopRealtimeSync() {
    clearTimeout(this._pushTimeout)
    this._pushTimeout = null
    if (this._unsubscribeSnapshots) {
      this._unsubscribeSnapshots()
      this._unsubscribeSnapshots = null
    }
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

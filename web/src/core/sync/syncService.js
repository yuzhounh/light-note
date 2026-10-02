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

export const syncService = {
  getSyncState,
  currentUser: null,
  _unsubscribeSnapshots: null,
  _pushTimeout: null,
  _isSyncing: false,
  _pushPromise: null,

  onDataChange: null,

  setUser(user, onDataChange = null) {
    if (onDataChange) this.onDataChange = onDataChange
    const prevUid = this.currentUser?.uid
    const nextUid = user?.uid
    this.currentUser = user

    if (prevUid !== nextUid) {
      this.stopRealtimeSync()
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
    if (this._isSyncing) return

    this._isSyncing = true
    syncState.status = 'syncing'
    syncState.error = null
    notifyListeners()

    try {
      const { firestore } = getServices()
      const uid = user.uid

      // 1. Pull remote notebooks
      const nbColRef = collection(firestore, 'users', uid, 'notebooks')
      const nbSnap = await getDocs(nbColRef)
      const remoteNotebooks = []
      nbSnap.forEach(d => {
        remoteNotebooks.push({ id: d.id, ...d.data() })
      })

      // 2. Pull remote notes
      const notesColRef = collection(firestore, 'users', uid, 'notes')
      const notesSnap = await getDocs(notesColRef)
      const remoteNotes = []
      notesSnap.forEach(d => {
        remoteNotes.push({ id: d.id, ...d.data() })
      })

      // 3. Pull remote attachments
      try {
        const attColRef = collection(firestore, 'users', uid, 'attachments')
        const attSnap = await getDocs(attColRef)
        const remoteAttachments = []
        attSnap.forEach(d => {
          remoteAttachments.push({ id: d.id, ...d.data() })
        })
        if (remoteAttachments.length > 0) {
          for (const att of remoteAttachments) {
            await db.attachments.put({
              id: att.id,
              sha256: att.sha256 || '',
              filename: att.filename || '',
              cloud_path: att.cloudPath || '',
              relative_path: att.relativePath || '',
              byte_size: att.size || 0,
              mime_type: att.mimeType || 'image/png',
              created_at: toIsoString(att.createdAt)
            })
          }
        }
      } catch (e) {
        console.warn('Sync attachments skipped:', e)
      }

      // If remote has data, clear unedited local demo notes
      if (remoteNotes.length > 0 || remoteNotebooks.length > 0) {
        await this._cleanDemoNotes(remoteNotes.map(n => n.id))
      }

      // Use the same transactional merge rules for full pulls and snapshots.
      for (const rNb of remoteNotebooks) {
        await mergeRemoteNotebook(rNb)
      }

      // 6. Merge remote notes into Dexie
      for (const rNote of remoteNotes) {
        await mergeRemoteNote(rNote)
      }

      await this.pushOutbox(user)

      // Update outbox count
      const remainingOutbox = await db.sync_outbox.count()
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
    if (this._pushPromise) return this._pushPromise
    this._pushPromise = (async () => {
      try {
        await pushPendingChanges((entityType, id, record) => this._uploadRecord(user, entityType, id, record))
        syncState.status = 'synced'
        syncState.error = null
        syncState.lastSyncedAt = new Date().toISOString()
      } catch (err) {
        syncState.status = 'error'
        syncState.error = err.message || '上传失败'
        throw err
      } finally {
        syncState.outboxCount = await db.sync_outbox.count()
        notifyListeners()
      }
    })()
    try {
      await this._pushPromise
    } finally {
      this._pushPromise = null
      if (syncState.outboxCount) this.notifyOutboxChanged(syncState.error ? 15000 : 1500)
    }
  },

  async _uploadRecord(user, entityType, id, record) {
    const { firestore } = getServices()
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

    const { firestore } = getServices()
    const uid = user.uid

    const unsubNotes = onSnapshot(collection(firestore, 'users', uid, 'notes'), async snapshot => {
      // Process doc changes
      let changed = false
      for (const change of snapshot.docChanges()) {
        const rNote = { id: change.doc.id, ...change.doc.data() }
        changed = await mergeRemoteNote(rNote, change.type) || changed
      }

      const cb = onDataChange || this.onDataChange
      if (changed && cb) {
        cb()
      }
    }, err => {
      console.warn('Realtime notes listener warning:', err)
    })

    const unsubNotebooks = onSnapshot(collection(firestore, 'users', uid, 'notebooks'), async snapshot => {
      let changed = false
      for (const change of snapshot.docChanges()) {
        const rNb = { id: change.doc.id, ...change.doc.data() }
        changed = await mergeRemoteNotebook(rNb, change.type) || changed
      }

      const cbNb = onDataChange || this.onDataChange
      if (changed && cbNb) {
        cbNb()
      }
    }, err => {
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
    if (!src || !src.startsWith('https://lightnote.attachments/')) {
      return src
    }

    if (attachmentUrlCache.has(src)) {
      return attachmentUrlCache.get(src)
    }

    const relPath = src.replace('https://lightnote.attachments/', '').trim()
    const { storage } = getServices()
    const uid = user?.uid

    if (!uid) return src

    try {
      // Find attachment by relative_path in db
      const att = await db.attachments.where('relative_path').equals(relPath).first()
      let cloudPath = att?.cloud_path
      if (!cloudPath) {
        // Fallback: construct standard cloud path from filename
        const filename = relPath.split('/').pop()
        const sha256 = filename.split('.')[0]
        cloudPath = `users/${uid}/attachments/${sha256}/${filename}`
      }

      const storageRef = ref(storage, cloudPath)
      const downloadUrl = await getDownloadURL(storageRef)
      attachmentUrlCache.set(src, downloadUrl)
      return downloadUrl
    } catch (err) {
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

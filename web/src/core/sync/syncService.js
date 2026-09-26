import { 
  getFirestore, 
  collection, 
  doc, 
  getDocs, 
  setDoc, 
  deleteDoc, 
  onSnapshot, 
  serverTimestamp, 
  Timestamp 
} from 'firebase/firestore'
import { getStorage, ref, getDownloadURL } from 'firebase/storage'
import { initFirebase } from '../auth/firebaseAuth'
import { db } from '../db/database'

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

/**
 * Format timestamp value to ISO string
 */
function toIsoString(val) {
  if (!val) return new Date().toISOString()
  if (typeof val.toDate === 'function') {
    return val.toDate().toISOString()
  }
  if (val instanceof Date) {
    return val.toISOString()
  }
  if (typeof val === 'string') {
    return val
  }
  if (typeof val === 'number') {
    return new Date(val).toISOString()
  }
  return new Date().toISOString()
}

/**
 * Format nullable timestamp value
 */
function toNullableIsoString(val) {
  if (!val) return null
  if (typeof val.toDate === 'function') {
    return val.toDate().toISOString()
  }
  if (val instanceof Date) {
    return val.toISOString()
  }
  if (typeof val === 'string') {
    return val
  }
  return null
}

const DEMO_TITLES = new Set([
  '具身智能',
  'AI 模型发布日报 | 9月24日',
  '开发计划',
  'V1.6: 交互细节统一',
  'TypeScript 5.8 新特性速览',
  '每周复盘模板'
])

export const syncService = {
  currentUser: null,
  _unsubscribeSnapshots: null,
  _pushTimeout: null,
  _isSyncing: false,

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

  notifyOutboxChanged() {
    if (!this.currentUser) return
    if (this._pushTimeout) clearTimeout(this._pushTimeout)
    this._pushTimeout = setTimeout(() => {
      this.pushOutbox(this.currentUser).catch(err => {
        console.warn('Auto-push outbox failed:', err)
      })
    }, 1500)
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

      // 5. Merge remote notebooks into Dexie
      for (const rNb of remoteNotebooks) {
        const local = await db.notebooks.get(rNb.id)
        const rUpdated = toIsoString(rNb.updatedAt)
        const rCreated = toIsoString(rNb.createdAt)
        const rDeleted = toNullableIsoString(rNb.deletedAt)

        if (!local) {
          await db.notebooks.put({
            id: rNb.id,
            name: rNb.name || '未命名笔记本',
            group_id: rNb.groupId || null,
            sort_order: Number(rNb.sortOrder ?? 0),
            created_at: rCreated,
            updated_at: rUpdated,
            deleted_at: rDeleted
          })
        } else if (new Date(rUpdated) >= new Date(local.updated_at || 0)) {
          await db.notebooks.update(rNb.id, {
            name: rNb.name || local.name,
            group_id: rNb.groupId !== undefined ? rNb.groupId : local.group_id,
            sort_order: rNb.sortOrder !== undefined ? Number(rNb.sortOrder) : local.sort_order,
            updated_at: rUpdated,
            deleted_at: rDeleted
          })
        }
      }

      // 6. Merge remote notes into Dexie
      const pendingOutbox = await db.sync_outbox.where('entity_type').equals('note').toArray()
      const pendingNoteIds = new Set(pendingOutbox.map(o => o.entity_id))

      for (const rNote of remoteNotes) {
        const local = await db.notes.get(rNote.id)
        const rUpdated = toIsoString(rNote.updatedAt)
        const rCreated = toIsoString(rNote.createdAt)
        const rDeleted = toNullableIsoString(rNote.deletedAt)
        const isDeleted = (rDeleted || rNote.isDeleted) ? 1 : 0
        const isPinned = rNote.isPinned ? 1 : 0

        // If local note has unpushed changes and local is newer, keep local
        if (local && pendingNoteIds.has(rNote.id)) {
          if (new Date(local.updated_at) > new Date(rUpdated)) {
            continue
          }
        }

        const noteRecord = {
          id: rNote.id,
          notebook_id: rNote.notebookId || null,
          title: rNote.title || '',
          body_html: rNote.bodyHtml || '',
          body_text: rNote.bodyText || '',
          body_json: rNote.bodyJson || null,
          is_pinned: isPinned,
          is_deleted: isDeleted,
          sort_order: Number(rNote.sortOrder ?? 1),
          created_at: rCreated,
          updated_at: rUpdated,
          deleted_at: rDeleted,
          version: Number(rNote.version || 1)
        }

        await db.notes.put(noteRecord)
      }

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

      // 7. Push any pending local outbox changes
      try {
        await this.pushOutbox(user)
      } catch (pushErr) {
        console.warn('Post-pull push outbox warning:', pushErr)
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
    const { firestore } = getServices()
    const uid = user.uid

    const items = await db.sync_outbox.toArray()
    if (!items.length) {
      syncState.outboxCount = 0
      notifyListeners()
      return
    }

    for (const item of items) {
      try {
        if (item.entity_type === 'note') {
          const noteRef = doc(firestore, 'users', uid, 'notes', item.entity_id)
          if (item.action === 'delete') {
            await deleteDoc(noteRef)
          } else {
            const note = await db.notes.get(item.entity_id)
            if (note) {
              const payload = {
                notebookId: note.notebook_id || null,
                title: note.title || '',
                bodyJson: note.body_json || JSON.stringify({ type: 'doc', content: [] }),
                bodyHtml: note.body_html || '',
                bodyText: note.body_text || '',
                isPinned: note.is_pinned === 1,
                createdAt: note.created_at ? Timestamp.fromDate(new Date(note.created_at)) : Timestamp.now(),
                updatedAt: note.updated_at ? Timestamp.fromDate(new Date(note.updated_at)) : Timestamp.now(),
                deletedAt: note.deleted_at ? Timestamp.fromDate(new Date(note.deleted_at)) : null,
                version: (note.version || 1) + 1,
                purgedAt: null,
                deviceId: 'web',
                tags: [],
                serverUpdatedAt: serverTimestamp()
              }
              await setDoc(noteRef, payload, { merge: true })
            }
          }
        } else if (item.entity_type === 'notebook') {
          const nbRef = doc(firestore, 'users', uid, 'notebooks', item.entity_id)
          if (item.action === 'delete') {
            await deleteDoc(nbRef)
          } else {
            const nb = await db.notebooks.get(item.entity_id)
            if (nb) {
              const payload = {
                name: nb.name || '未命名笔记本',
                sortOrder: nb.sort_order || 0,
                createdAt: nb.created_at ? Timestamp.fromDate(new Date(nb.created_at)) : Timestamp.now(),
                updatedAt: nb.updated_at ? Timestamp.fromDate(new Date(nb.updated_at)) : Timestamp.now(),
                deletedAt: nb.deleted_at ? Timestamp.fromDate(new Date(nb.deleted_at)) : null,
                serverUpdatedAt: serverTimestamp()
              }
              await setDoc(nbRef, payload, { merge: true })
            }
          }
        }
        await db.sync_outbox.delete(item.id)
      } catch (err) {
        console.warn(`Failed to push outbox item ${item.id}:`, err)
        break // Stop on error and retry later
      }
    }

    const count = await db.sync_outbox.count()
    syncState.outboxCount = count
    notifyListeners()
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
        const rUpdated = toIsoString(rNote.updatedAt)
        const local = await db.notes.get(rNote.id)

        if (change.type === 'removed') {
          if (local) {
            await db.notes.delete(rNote.id)
            changed = true
          }
          continue
        }

        const pendingOutbox = await db.sync_outbox
          .where('entity_type').equals('note')
          .and(o => o.entity_id === rNote.id)
          .first()

        if (pendingOutbox && local && new Date(local.updated_at) > new Date(rUpdated)) {
          continue
        }

        const rCreated = toIsoString(rNote.createdAt)
        const rDeleted = toNullableIsoString(rNote.deletedAt)
        const isDeleted = (rDeleted || rNote.isDeleted) ? 1 : 0
        const isPinned = rNote.isPinned ? 1 : 0

        await db.notes.put({
          id: rNote.id,
          notebook_id: rNote.notebookId || null,
          title: rNote.title || '',
          body_html: rNote.bodyHtml || '',
          body_text: rNote.bodyText || '',
          body_json: rNote.bodyJson || null,
          is_pinned: isPinned,
          is_deleted: isDeleted,
          sort_order: Number(rNote.sortOrder ?? 1),
          created_at: rCreated,
          updated_at: rUpdated,
          deleted_at: rDeleted,
          version: Number(rNote.version || 1)
        })
        changed = true
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
        if (change.type === 'removed') {
          await db.notebooks.delete(rNb.id)
          changed = true
          continue
        }

        const rUpdated = toIsoString(rNb.updatedAt)
        const rCreated = toIsoString(rNb.createdAt)
        const rDeleted = toNullableIsoString(rNb.deletedAt)

        await db.notebooks.put({
          id: rNb.id,
          name: rNb.name || '未命名笔记本',
          group_id: rNb.groupId || null,
          sort_order: Number(rNb.sortOrder ?? 0),
          created_at: rCreated,
          updated_at: rUpdated,
          deleted_at: rDeleted
        })
        changed = true
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
      const isDemo = note.is_demo === 1 || DEMO_TITLES.has(note.title)
      if (isDemo && !outboxNoteIds.has(note.id) && !remoteIdSet.has(note.id)) {
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

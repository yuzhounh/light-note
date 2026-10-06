import { db, DEFAULT_NOTEBOOK_ID } from './database.js'
import { syncService } from '../sync/syncService.js'
import { queueOutbox, purgedNote } from '../sync/syncStore.js'
import { noteDrafts } from '../sync/noteDrafts.js'

export function getFormattedLocalTimestamp() {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}


// --- 历史版本策略（与桌面端一致）---
// 每个编辑时段（两次快照至少相隔 10 分钟）只保存时段开始前的内容；
// 48 小时以内的版本全部保留，更早的每天只保留最后一个，总数最多 50 个。
const VERSIONED_FIELDS = ['title', 'body_html', 'body_text', 'body_json']
const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000
const THINNING_AGE_MS = 48 * 60 * 60 * 1000
const MAX_VERSIONS = 50
const lastSnapshotAt = new Map()

async function snapshotBeforeChange(note, nextUpdatedAt, force) {
  const last = lastSnapshotAt.get(note.id)
  if (!force && last !== undefined && Date.parse(nextUpdatedAt) - last < SNAPSHOT_INTERVAL_MS) return
  await db.note_versions.add({
    id: crypto.randomUUID(),
    note_id: note.id,
    version: note.version || 1,
    title: note.title,
    body_html: note.body_html,
    body_text: note.body_text,
    body_json: note.body_json,
    created_at: note.updated_at || nextUpdatedAt,
  })
  lastSnapshotAt.set(note.id, Date.parse(nextUpdatedAt))
  await trimVersions(note.id)
}

async function trimVersions(noteId) {
  const all = (await db.note_versions.where('note_id').equals(noteId).toArray())
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  const cutoff = new Date(Date.now() - THINNING_AGE_MS).toISOString()
  const seenDays = new Set()
  const keep = []
  for (const version of all) {
    if (version.created_at >= cutoff) {
      keep.push(version)
      continue
    }
    const day = version.created_at.slice(0, 10)
    if (seenDays.has(day)) continue
    seenDays.add(day)
    keep.push(version)
  }
  const keepIds = new Set(keep.slice(0, MAX_VERSIONS).map(version => version.id))
  const removeIds = all.filter(version => !keepIds.has(version.id)).map(version => version.id)
  if (removeIds.length) await db.note_versions.bulkDelete(removeIds)
}

export const NotesRepository = {
  // --- Notebooks ---
  async getAllNotebooks() {
    return await db.notebooks
      .filter(nb => !nb.deleted_at)
      .sortBy('sort_order')
  },

  async createNotebook(name) {
    const trimmed = name.trim()
    if (!trimmed) return null

    // Check if notebook with same name already exists
    const existing = await db.notebooks
      .filter(nb => !nb.deleted_at && (nb.name || '').trim().toLowerCase() === trimmed.toLowerCase())
      .first()
    if (existing) {
      return existing
    }

    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const count = await db.notebooks.count()
    const notebook = {
      id,
      name: trimmed,
      group_id: null,
      sort_order: count + 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }
    await db.transaction('rw', db.notebooks, db.sync_outbox, async () => {
      await db.notebooks.add(notebook)
      await queueOutbox('notebook', id)
    })
    syncService.notifyOutboxChanged()
    return notebook
  },

  async updateNotebook(id, changes) {
    const now = new Date().toISOString()
    await db.transaction('rw', db.notebooks, db.sync_outbox, async () => {
      if (await db.notebooks.update(id, { ...changes, updated_at: now })) {
        await queueOutbox('notebook', id)
      }
    })
    syncService.notifyOutboxChanged()
  },

  async deleteNotebook(id) {
    await this.updateNotebook(id, { deleted_at: new Date().toISOString() })
  },

  // --- Notes ---
  async getNotes({ notebookId = null, view = 'all', searchQuery = '', sortBy = 'created', descending = true } = {}) {
    let query = db.notes

    if (view === 'trash') {
      let notes = await query.filter(n => !!n.is_deleted && !n.purged_at).toArray()
      return notes.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    }

    let notes = await query.filter(n => !n.is_deleted && !n.purged_at).toArray()

    if (notebookId) {
      notes = notes.filter(n => n.notebook_id === notebookId)
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      notes = notes.filter(n => 
        (n.title && n.title.toLowerCase().includes(q)) ||
        (n.body_text && n.body_text.toLowerCase().includes(q))
      )
    }

    // Sort: by created_at or updated_at, descending (newest first) by default
    const field = sortBy === 'updated' ? 'updated_at' : 'created_at'
    const direction = descending ? -1 : 1
    return notes.sort((a, b) => {
      const diff = new Date(a[field] || a.updated_at) - new Date(b[field] || b.updated_at)
      return diff !== 0 ? diff * direction : String(a.id).localeCompare(String(b.id)) * direction
    })
  },

  async getNoteById(id) {
    const note = await db.notes.get(id)
    return note?.purged_at ? undefined : note
  },

  async createNote({ notebookId, title = '', bodyHtml = '<p></p>', bodyText = '',
    bodyJson = '{"type":"doc","content":[{"type":"paragraph"}]}' }) {
    const cleanTitle = title.trim() || '无标题笔记'
    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    let targetNotebookId = notebookId
    if (!targetNotebookId) {
      const firstNb = await db.notebooks.filter(nb => !nb.deleted_at).first()
      targetNotebookId = firstNb ? firstNb.id : DEFAULT_NOTEBOOK_ID
    }

    const note = {
      id,
      notebook_id: targetNotebookId,
      title: cleanTitle,
      body_html: bodyHtml,
      body_text: bodyText,
      body_json: bodyJson,
      tags: [],
      version: 1,
      purged_at: null,
      is_pinned: 0,
      is_deleted: 0,
      sort_order: 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }
    await db.transaction('rw', db.notes, db.sync_outbox, async () => {
      await db.notes.add(note)
      await queueOutbox('note', id)
    })
    syncService.notifyOutboxChanged()
    return note
  },

  async saveNote(id, { title, bodyHtml, bodyText, bodyJson }) {
    const cleanTitle = title.trim() || '无标题笔记'
    await this._updateNote(id, {
      title: cleanTitle,
      body_html: bodyHtml,
      body_text: bodyText,
      ...(bodyJson !== undefined ? { body_json: bodyJson } : {}),
    })
  },

  async _updateNote(id, changes, { forceSnapshot = false } = {}) {
    await db.transaction('rw', db.notes, db.sync_outbox, db.note_versions, async () => {
      const note = await db.notes.get(id)
      if (!note || note.purged_at) return
      const applied = typeof changes === 'function' ? changes(note) : changes
      const updatedAt = new Date().toISOString()
      if (VERSIONED_FIELDS.some(field => field in applied && applied[field] !== note[field])) {
        await snapshotBeforeChange(note, updatedAt, forceSnapshot)
      }
      await db.notes.update(id, {
        ...applied,
        updated_at: updatedAt, version: (note.version || 1) + 1,
      })
      await queueOutbox('note', id)
    })
    syncService.notifyOutboxChanged()
  },

  // --- 历史版本 ---
  async getNoteVersions(noteId) {
    const versions = await db.note_versions.where('note_id').equals(noteId).toArray()
    return versions.sort((a, b) => b.created_at.localeCompare(a.created_at))
  },

  async restoreNoteVersion(noteId, versionId) {
    const version = await db.note_versions.get(versionId)
    if (!version || version.note_id !== noteId) return undefined
    // 恢复前一定保存当前内容，避免丢失尚未形成版本的最新修改
    await this._updateNote(noteId, {
      title: version.title,
      body_html: version.body_html,
      body_text: version.body_text,
      body_json: version.body_json,
    }, { forceSnapshot: true })
    return db.notes.get(noteId)
  },

  async softDeleteNote(id) {
    const now = new Date().toISOString()
    await this._updateNote(id, { is_deleted: 1, deleted_at: now })
  },

  async restoreNote(id) {
    await this._updateNote(id, { is_deleted: 0, deleted_at: null })
  },

  async permanentDeleteNote(id) {
    noteDrafts.discard(id)
    await db.transaction('rw', db.notes, db.note_tags, db.sync_outbox, db.note_versions, async () => {
      const note = await db.notes.get(id)
      if (!note || note.purged_at) return
      await db.notes.put(purgedNote(id, new Date().toISOString(), note))
      await db.note_tags.where('note_id').equals(id).delete()
      await db.note_versions.where('note_id').equals(id).delete()
      await queueOutbox('note', id)
    })
    noteDrafts.notify()
    syncService.notifyOutboxChanged()
  },

  async emptyTrash() {
    const notes = await this.getNotes({ view: 'trash' })
    for (const note of notes) await this.permanentDeleteNote(note.id)
  },

  // --- Outbox Sync Queue ---
  async queueOutbox(entityType, entityId, action) {
    await db.transaction('rw', db.sync_outbox, () => queueOutbox(entityType, entityId, action))
    syncService.notifyOutboxChanged()
  }
}

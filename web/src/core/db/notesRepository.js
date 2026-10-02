import { db, DEFAULT_NOTEBOOK_ID } from './database.js'
import { syncService } from '../sync/syncService.js'
import { queueOutbox, purgedNote } from '../sync/syncStore.js'
import { noteDrafts } from '../sync/noteDrafts.js'

export function getFormattedLocalTimestamp() {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
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
  async getNotes({ notebookId = null, view = 'all', searchQuery = '' } = {}) {
    let query = db.notes

    if (view === 'trash') {
      let notes = await query.filter(n => !!n.is_deleted && !n.purged_at).toArray()
      return notes.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    }

    let notes = await query.filter(n => !n.is_deleted && !n.purged_at).toArray()

    if (view === 'pinned') {
      notes = notes.filter(n => n.is_pinned === 1)
    } else if (notebookId) {
      notes = notes.filter(n => n.notebook_id === notebookId)
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      notes = notes.filter(n => 
        (n.title && n.title.toLowerCase().includes(q)) ||
        (n.body_text && n.body_text.toLowerCase().includes(q))
      )
    }

    // Sort: pinned first, then updated_at descending
    return notes.sort((a, b) => {
      if ((b.is_pinned || 0) !== (a.is_pinned || 0)) {
        return (b.is_pinned || 0) - (a.is_pinned || 0)
      }
      return new Date(b.updated_at) - new Date(a.updated_at)
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

  async _updateNote(id, changes) {
    await db.transaction('rw', db.notes, db.sync_outbox, async () => {
      const note = await db.notes.get(id)
      if (!note || note.purged_at) return
      await db.notes.update(id, {
        ...(typeof changes === 'function' ? changes(note) : changes),
        updated_at: new Date().toISOString(), version: (note.version || 1) + 1,
      })
      await queueOutbox('note', id)
    })
    syncService.notifyOutboxChanged()
  },

  async togglePin(id) {
    await this._updateNote(id, note => ({ is_pinned: note.is_pinned === 1 ? 0 : 1 }))
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
    await db.transaction('rw', db.notes, db.note_tags, db.sync_outbox, async () => {
      const note = await db.notes.get(id)
      if (!note || note.purged_at) return
      await db.notes.put(purgedNote(id, new Date().toISOString(), note))
      await db.note_tags.where('note_id').equals(id).delete()
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

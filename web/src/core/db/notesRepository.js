import { db } from './database'

export const NotesRepository = {
  // --- Notebooks ---
  async getAllNotebooks() {
    return await db.notebooks
      .filter(nb => !nb.deleted_at)
      .sortBy('sort_order')
  },

  async createNotebook(name) {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const count = await db.notebooks.count()
    const notebook = {
      id,
      name: name.trim() || '未命名笔记本',
      group_id: null,
      sort_order: count + 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }
    await db.notebooks.add(notebook)
    await this.queueOutbox('notebook', id, 'upsert')
    return notebook
  },

  async updateNotebook(id, changes) {
    const now = new Date().toISOString()
    await db.notebooks.update(id, { ...changes, updated_at: now })
    await this.queueOutbox('notebook', id, 'upsert')
  },

  async deleteNotebook(id) {
    const now = new Date().toISOString()
    await db.notebooks.update(id, { deleted_at: now, updated_at: now })
    await this.queueOutbox('notebook', id, 'delete')
  },

  // --- Notes ---
  async getNotes({ notebookId = null, view = 'all', searchQuery = '' } = {}) {
    let query = db.notes

    if (view === 'trash') {
      let notes = await query.filter(n => !!n.is_deleted).toArray()
      return notes.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    }

    let notes = await query.filter(n => !n.is_deleted).toArray()

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
    return await db.notes.get(id)
  },

  async createNote({ notebookId, title = '', bodyHtml = '', bodyText = '' }) {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const note = {
      id,
      notebook_id: notebookId,
      title: title.trim(),
      body_html: bodyHtml,
      body_text: bodyText,
      is_pinned: 0,
      is_deleted: 0,
      sort_order: 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }
    await db.notes.add(note)
    await this.queueOutbox('note', id, 'upsert')
    return note
  },

  async saveNote(id, { title, bodyHtml, bodyText }) {
    const now = new Date().toISOString()
    await db.notes.update(id, {
      title,
      body_html: bodyHtml,
      body_text: bodyText,
      updated_at: now,
    })
    await this.queueOutbox('note', id, 'upsert')
  },

  async togglePin(id) {
    const note = await db.notes.get(id)
    if (!note) return
    const isPinned = note.is_pinned === 1 ? 0 : 1
    const now = new Date().toISOString()
    await db.notes.update(id, { is_pinned: isPinned, updated_at: now })
    await this.queueOutbox('note', id, 'upsert')
  },

  async softDeleteNote(id) {
    const now = new Date().toISOString()
    await db.notes.update(id, { is_deleted: 1, deleted_at: now, updated_at: now })
    await this.queueOutbox('note', id, 'upsert')
  },

  async restoreNote(id) {
    const now = new Date().toISOString()
    await db.notes.update(id, { is_deleted: 0, deleted_at: null, updated_at: now })
    await this.queueOutbox('note', id, 'upsert')
  },

  async permanentDeleteNote(id) {
    await db.notes.delete(id)
    await this.queueOutbox('note', id, 'delete')
  },

  // --- Outbox Sync Queue ---
  async queueOutbox(entityType, entityId, action) {
    const now = new Date().toISOString()
    await db.sync_outbox.add({
      entity_type: entityType,
      entity_id: entityId,
      action,
      created_at: now,
      retry_count: 0
    })
  }
}

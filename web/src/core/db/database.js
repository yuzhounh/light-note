import Dexie from 'dexie'
import { noteDrafts } from '../sync/noteDrafts.js'

export class LightNoteDatabase extends Dexie {
  constructor() {
    super('LightNoteDB')
    
    this.version(1).stores({
      notebooks: 'id, name, group_id, sort_order, updated_at, deleted_at',
      notes: 'id, notebook_id, title, is_pinned, is_deleted, sort_order, updated_at, deleted_at',
      tags: 'id, name',
      note_tags: '[note_id+tag_id], note_id, tag_id',
      attachments: 'sha256, filename, byte_size, created_at',
      sync_outbox: '++id, entity_type, entity_id, action, created_at',
      settings: 'key'
    })

    // 版本 2：本地历史版本（仅保存在本设备，不参与云端同步）
    this.version(2).stores({
      note_versions: 'id, note_id, created_at'
    })
  }
}

export const db = new LightNoteDatabase()

/**
 * Purge any mock/demo notes that were seeded in previous versions
 */
export async function purgeLegacyDemoNotes() {
  const demoTitles = new Set([
    '具身智能',
    'AI 模型发布日报 | 9月24日',
    '开发计划',
    'V1.6: 交互细节统一',
    'TypeScript 5.8 新特性速览',
    '每周复盘模板'
  ])

  try {
    const notes = await db.notes.toArray()
    const pending = new Set((await db.sync_outbox.where('entity_type').equals('note').toArray())
      .map(item => item.entity_id))
    for (const n of notes) {
      // If note was created as demo or matches demo title with demo date
      if (!pending.has(n.id) && !noteDrafts.has(n.id) &&
        (n.is_demo === 1 || (demoTitles.has(n.title) && n.created_at?.includes('2026-09-25T10:02')))) {
        await db.notes.delete(n.id)
      }
    }

    const nbs = await db.notebooks.toArray()
    for (const nb of nbs) {
      if (nb.is_demo === 1) {
        const remaining = await db.notes.where('notebook_id').equals(nb.id).count()
        if (remaining === 0) {
          await db.notebooks.delete(nb.id)
        }
      }
    }
  } catch (e) {
    console.warn('Failed to purge demo notes:', e)
  }
}

export const CANONICAL_NOTEBOOKS = {
  '默认': '4002cfd9-501b-4292-b405-9b58128259a5',
  'LightNote 开发记录': 'lightnote-dev-history'
}
export const DEFAULT_NOTEBOOK_ID = '4002cfd9-501b-4292-b405-9b58128259a5'

/**
 * Deduplicate notebooks by name, merging any duplicates into canonical notebooks,
 * reassigning orphaned notes, and removing redundant local notebooks.
 */
export async function deduplicateNotebooks() {
  const merge = async () => {
    const allNbs = await db.notebooks.toArray()
    if (!allNbs.length) return
    const pending = await db.sync_outbox.toArray()
    const pendingNotebooks = new Set(pending.filter(item => item.entity_type === 'notebook')
      .map(item => item.entity_id))
    const pendingNotes = new Set(pending.filter(item => item.entity_type === 'note')
      .map(item => item.entity_id))

    // Group by normalized name (trimmed, lowercased)
    const groups = new Map()
    for (const nb of allNbs) {
      if (nb.deleted_at) continue
      const normName = (nb.name || '').trim().toLowerCase()
      if (!groups.has(normName)) {
        groups.set(normName, [])
      }
      groups.get(normName).push(nb)
    }

    for (const [normName, nbs] of groups.entries()) {
      if (nbs.length <= 1) continue
      if (nbs.some(nb => pendingNotebooks.has(nb.id))) continue
      const ids = new Set(nbs.map(nb => nb.id))
      const protectedNotes = await db.notes.filter(note => ids.has(note.notebook_id) &&
        (pendingNotes.has(note.id) || noteDrafts.has(note.id))).count()
      if (protectedNotes) continue

      // Find canonical notebook:
      // 1. Check known canonical IDs from desktop / Firestore
      let canonical = nbs.find(nb => 
        nb.id === '4002cfd9-501b-4292-b405-9b58128259a5' || 
        nb.id === 'lightnote-dev-history'
      )
      // 2. Otherwise pick non-deleted or first
      if (!canonical) {
        canonical = nbs.find(nb => !nb.deleted_at) || nbs[0]
      }

      for (const nb of nbs) {
        if (nb.id === canonical.id) continue

        // Reassign all notes under nb.id to canonical.id
        const notesToMove = await db.notes.where('notebook_id').equals(nb.id)
          .and(note => !note.purged_at).toArray()
        for (const note of notesToMove) {
          await db.notes.update(note.id, { 
            notebook_id: canonical.id,
            updated_at: new Date().toISOString()
          })
          // Queue outbox for note update so cloud receives the canonical notebookId
          await db.sync_outbox.add({
            entity_type: 'note',
            entity_id: note.id,
            action: 'upsert',
            created_at: new Date().toISOString()
          })
        }

        // Clean outbox entries for the duplicate notebook to prevent remote accidental deletes
        const outboxItems = await db.sync_outbox.where('entity_type').equals('notebook').toArray()
        for (const item of outboxItems) {
          if (item.entity_id === nb.id) {
            await db.sync_outbox.delete(item.id)
          }
        }

        // Delete redundant notebook from local database
        await db.notebooks.delete(nb.id)
      }
    }

    // Also repair any notes whose notebook_id doesn't exist at all
    const remainingNbs = await db.notebooks.toArray()
    const validNbIds = new Set(remainingNbs.map(n => n.id))
    const orphanNotes = await db.notes.filter(n => !n.purged_at && n.notebook_id &&
      !validNbIds.has(n.notebook_id) && !pendingNotes.has(n.id) && !noteDrafts.has(n.id)).toArray()
    for (const on of orphanNotes) {
      await db.notes.update(on.id, { notebook_id: DEFAULT_NOTEBOOK_ID })
    }
  }
  try {
    await db.transaction('rw', db.notebooks, db.notes, db.sync_outbox, merge)
  } catch (e) {
    console.warn('Failed to deduplicate notebooks:', e)
  }
}

/**
 * Initialize clean state: ensure at least one default notebook exists if completely empty, but ZERO fake notes.
 */
export async function seedInitialData() {
  await purgeLegacyDemoNotes()
  await deduplicateNotebooks()
  const count = await db.notebooks.count()
  if (count === 0) {
    const now = new Date().toISOString()
    await db.notebooks.add({
      id: DEFAULT_NOTEBOOK_ID,
      name: '默认',
      group_id: null,
      sort_order: 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    })
  }
}

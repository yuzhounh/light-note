import Dexie from 'dexie'

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
    for (const n of notes) {
      // If note was created as demo or matches demo title with demo date
      if (n.is_demo === 1 || (demoTitles.has(n.title) && n.created_at?.includes('2026-09-25T10:02'))) {
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

/**
 * Initialize clean state: ensure at least one default notebook exists if completely empty, but ZERO fake notes.
 */
export async function seedInitialData() {
  await purgeLegacyDemoNotes()
  const count = await db.notebooks.count()
  if (count === 0) {
    const now = new Date().toISOString()
    await db.notebooks.add({
      id: crypto.randomUUID(),
      name: '默认',
      group_id: null,
      sort_order: 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    })
  }
}

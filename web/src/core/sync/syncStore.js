import { db } from '../db/database.js'
import { noteDrafts } from './noteDrafts.js'

export function toIsoString(value, fallback = new Date().toISOString()) {
  if (!value) return fallback
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date || typeof value === 'number') return new Date(value).toISOString()
  return typeof value === 'string' ? value : fallback
}

// A fresh queue ID is the acknowledgement token for this exact local change.
export async function queueOutbox(entityType, entityId, action = 'upsert') {
  await db.sync_outbox.where('entity_type').equals(entityType)
    .and(item => item.entity_id === entityId).delete()
  return db.sync_outbox.add({
    entity_type: entityType, entity_id: entityId, action,
    created_at: new Date().toISOString(), retry_count: 0
  })
}

export function purgedNote(id, now, local = {}) {
  return {
    ...local, id, notebook_id: null, title: '已永久删除的笔记',
    body_json: '{"type":"doc","content":[{"type":"paragraph"}]}',
    body_html: '<p></p>', body_text: '', tags: [], is_pinned: 0, is_deleted: 1,
    created_at: local.created_at || now, updated_at: now,
    deleted_at: local.deleted_at || now, purged_at: now,
    version: (local.version || 1) + 1
  }
}

export async function mergeRemoteNote(remote, type = 'modified') {
  // Physical removal has no durable deletion event for an offline desktop.
  // Both clients propagate deletion through deletedAt/purgedAt instead.
  if (type === 'removed') return false
  return db.transaction('rw', db.notes, db.sync_outbox, async () => {
    const local = await db.notes.get(remote.id)
    const pending = await db.sync_outbox.where('entity_type').equals('note')
      .and(item => item.entity_id === remote.id).count()
    if (pending || noteDrafts.has(remote.id)) return false
    const updatedAt = toIsoString(remote.updatedAt)
    if (local && new Date(local.updated_at) >= new Date(updatedAt)) return false
    const deletedAt = toIsoString(remote.deletedAt, null)
    const purgedAt = toIsoString(remote.purgedAt, null)
    const record = {
      ...local, id: remote.id, notebook_id: remote.notebookId || null,
      title: remote.title || '', body_html: remote.bodyHtml || '',
      body_text: remote.bodyText || '', body_json: remote.bodyJson || null,
      is_pinned: remote.isPinned ? 1 : 0,
      is_deleted: (deletedAt || purgedAt || remote.isDeleted) ? 1 : 0,
      sort_order: Number(remote.sortOrder ?? 1),
      created_at: toIsoString(remote.createdAt), updated_at: updatedAt,
      deleted_at: deletedAt, purged_at: purgedAt, version: Number(remote.version || 1)
    }
    // Missing tags means unknown, not an instruction to clear desktop labels.
    if (Array.isArray(remote.tags)) record.tags = remote.tags
    if (purgedAt) Object.assign(record, purgedNote(remote.id, purgedAt, record), {
      updated_at: updatedAt, version: Number(remote.version || 1)
    })
    await db.notes.put(record)
    return true
  })
}

export async function mergeRemoteNotebook(remote, type = 'modified') {
  if (type === 'removed') return false
  return db.transaction('rw', db.notebooks, db.sync_outbox, async () => {
    const local = await db.notebooks.get(remote.id)
    const pending = await db.sync_outbox.where('entity_type').equals('notebook')
      .and(item => item.entity_id === remote.id).count()
    const updatedAt = toIsoString(remote.updatedAt)
    if (pending || (local && new Date(local.updated_at) >= new Date(updatedAt))) return false
    await db.notebooks.put({
      ...local, id: remote.id, name: remote.name || local?.name || '未命名笔记本',
      group_id: remote.groupId ?? local?.group_id ?? null,
      sort_order: Number(remote.sortOrder ?? local?.sort_order ?? 0),
      created_at: toIsoString(remote.createdAt), updated_at: updatedAt,
      deleted_at: toIsoString(remote.deletedAt, null)
    })
    return true
  })
}

export async function prepareUpload(item) {
  return db.transaction('rw', db.notes, db.notebooks, db.sync_outbox, async () => {
    if (!await db.sync_outbox.get(item.id)) return null
    if (item.entity_type === 'note' && noteDrafts.has(item.entity_id)) return null
    const table = item.entity_type === 'note' ? db.notes
      : item.entity_type === 'notebook' ? db.notebooks : null
    if (!table) throw new Error(`不支持的同步类型：${item.entity_type}`)
    let record = await table.get(item.entity_id)
    // Upgrade queued hard deletes from older web versions to durable tombstones.
    if (item.action === 'delete') {
      const now = item.created_at || new Date().toISOString()
      record = item.entity_type === 'note' ? purgedNote(item.entity_id, now, record)
        : { ...record, id: item.entity_id, name: record?.name || '已删除的笔记本',
            created_at: record?.created_at || now, updated_at: now, deleted_at: now }
      await table.put(record)
    }
    if (!record) throw new Error('待上传记录不存在，已保留同步队列')
    return record
  })
}

export async function pushPendingChanges(upload) {
  const items = await db.sync_outbox.toArray()
  const latest = new Map()
  for (const item of items) latest.set(`${item.entity_type}:${item.entity_id}`, item)
  for (const item of latest.values()) {
    const record = await prepareUpload(item)
    if (!record) continue
    await upload(item.entity_type, item.entity_id, record)
    // New changes have a higher queue ID and survive this acknowledgement.
    await db.sync_outbox.where('entity_type').equals(item.entity_type)
      .and(queued => queued.entity_id === item.entity_id && queued.id <= item.id).delete()
  }
}

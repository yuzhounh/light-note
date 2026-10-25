import { db } from '../db/database.js'
import { noteDrafts } from './noteDrafts.js'

export function toIsoString(value, fallback = new Date().toISOString()) {
  if (!value) return fallback
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date || typeof value === 'number') return new Date(value).toISOString()
  return typeof value === 'string' ? value : fallback
}

// Queue lookups start from the entity_id index instead of scanning every queued item of a type.
const queuedFor = (entityType, entityId) => db.sync_outbox.where('entity_id').equals(entityId)
  .and(item => item.entity_type === entityType)

// A fresh queue ID is the acknowledgement token for this exact local change.
export async function queueOutbox(entityType, entityId, action = 'upsert') {
  await queuedFor(entityType, entityId).delete()
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

export async function mergeRemoteNote(remote, type = 'modified', onBlocked = null) {
  // Physical removal has no durable deletion event for an offline desktop.
  // Both clients propagate deletion through deletedAt/purgedAt instead.
  if (type === 'removed') return false
  return db.transaction('rw', db.notes, db.sync_outbox, async () => {
    const local = await db.notes.get(remote.id)
    const pending = await queuedFor('note', remote.id).count()
    if (pending || noteDrafts.has(remote.id)) { onBlocked?.(); return false }
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

export async function mergeRemoteNotebook(remote, type = 'modified', onBlocked = null) {
  if (type === 'removed') return false
  return db.transaction('rw', db.notebooks, db.sync_outbox, async () => {
    const local = await db.notebooks.get(remote.id)
    const pending = await queuedFor('notebook', remote.id).count()
    const updatedAt = toIsoString(remote.updatedAt)
    if (pending) { onBlocked?.(); return false }
    if (local && new Date(local.updated_at) >= new Date(updatedAt)) return false
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

export async function prepareUpload(item, assertCurrent = () => {}) {
  return db.transaction('rw', db.notes, db.notebooks, db.sync_outbox, async () => {
    assertCurrent()
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
    assertCurrent()
    return record
  })
}

// One commit carries up to this many records and roughly this much text, well under Firestore's 500 writes / 10 MiB.
const BATCH_RECORDS = 100
const BATCH_CHARS = 4_000_000

/**
 * Uploads queued records, several per commit when `uploadBatch` is given. A failed batch is retried one
 * record at a time, so one bad record cannot hold back the others before it.
 */
export async function pushPendingChanges(upload, assertCurrent = () => {}, uploadBatch = null) {
  const items = await db.sync_outbox.toArray()
  assertCurrent()
  const latest = new Map()
  for (const item of items) latest.set(`${item.entity_type}:${item.entity_id}`, item)
  // New changes have a higher queue ID and survive this acknowledgement.
  const acknowledge = item => db.transaction('rw', db.sync_outbox, async () => {
    assertCurrent()
    await queuedFor(item.entity_type, item.entity_id).and(queued => queued.id <= item.id).delete()
    assertCurrent()
  })
  const uploadOne = async entry => {
    await upload(entry.item.entity_type, entry.item.entity_id, entry.record)
    assertCurrent()
    await acknowledge(entry.item)
  }
  let batch = [], chars = 0
  const flush = async () => {
    const entries = batch
    batch = []; chars = 0
    if (!entries.length) return
    if (entries.length === 1) { await uploadOne(entries[0]); return }
    try {
      await uploadBatch(entries.map(({ item, record }) => ({ entityType: item.entity_type, id: item.entity_id, record })))
    } catch {
      assertCurrent()
      for (const entry of entries) await uploadOne(entry)
      return
    }
    assertCurrent()
    for (const entry of entries) await acknowledge(entry.item)
  }
  for (const item of latest.values()) {
    assertCurrent()
    const record = await prepareUpload(item, assertCurrent)
    assertCurrent()
    if (!record) continue
    if (!uploadBatch) { await uploadOne({ item, record }); continue }
    const size = JSON.stringify(record).length
    if (batch.length && (batch.length >= BATCH_RECORDS || chars + size > BATCH_CHARS)) await flush()
    batch.push({ item, record }); chars += size
  }
  await flush()
}

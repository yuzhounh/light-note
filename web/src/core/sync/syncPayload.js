import { Timestamp, serverTimestamp } from 'firebase/firestore'

const timestamp = value => value ? Timestamp.fromDate(new Date(value)) : null

export function buildSyncPayload(entityType, record) {
  const common = {
    createdAt: timestamp(record.created_at) || Timestamp.now(),
    updatedAt: timestamp(record.updated_at) || Timestamp.now(),
    deletedAt: timestamp(record.deleted_at),
    deviceId: 'web', serverUpdatedAt: serverTimestamp()
  }
  if (entityType === 'notebook') {
    return { ...common, name: record.name || '未命名笔记本', sortOrder: record.sort_order || 0 }
  }
  const payload = {
    ...common, notebookId: record.notebook_id || null,
    title: record.title || '', bodyJson: record.body_json || '{"type":"doc","content":[]}',
    bodyHtml: record.body_html || '', bodyText: record.body_text || '',
    isPinned: record.is_pinned === 1, version: record.version || 1,
    purgedAt: timestamp(record.purged_at)
  }
  // Older browser caches may never have downloaded tags. Omit an unknown field.
  if (Array.isArray(record.tags)) payload.tags = record.tags
  return payload
}

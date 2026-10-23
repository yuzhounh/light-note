import { Timestamp } from 'firebase/firestore'
import { db } from '../db/database.js'

export const SYNC_PAGE_SIZE = 200
const PREFIX = 'lightnote-sync:cursor:v1:'
const OWNER = 'lightnote-sync:owner:v1'
const EPOCH = 'lightnote-sync:epoch:v1'
export const cursorKey = (uid, kind) => `${PREFIX}${encodeURIComponent(uid)}:${kind}`
export const deferredPrefix = uid => `lightnote-sync:deferred:v1:${encodeURIComponent(uid)}:`
export const deferredKey = (uid, kind, id) => `${deferredPrefix(uid)}${kind}:${encodeURIComponent(id)}`
const zero = () => ({ seconds: 0, nanoseconds: 0, id: '' })
const timestamp = cursor => new Timestamp(cursor.seconds, cursor.nanoseconds)

export function documentCursor(record) {
  const value = record.serverUpdatedAt
  return value && Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds)
    ? { seconds: value.seconds, nanoseconds: value.nanoseconds, id: record.id } : null
}

export function newestCursor(left, right) {
  if (!left) return right
  if (!right) return left
  if (left.seconds !== right.seconds) return left.seconds > right.seconds ? left : right
  if (left.nanoseconds !== right.nanoseconds) return left.nanoseconds > right.nanoseconds ? left : right
  // Firestore document names use UTF-8 byte order, not the current UI locale.
  const a = new TextEncoder().encode(left.id), b = new TextEncoder().encode(right.id)
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] > b[i] ? left : right
  return a.length >= b.length ? left : right
}

export function serverRecords(snapshot) {
  if (snapshot.metadata?.fromCache || snapshot.metadata?.hasPendingWrites) {
    throw new Error('尚未从云端取得最新记录，请检查网络后下拉重试')
  }
  const rows = []
  snapshot.forEach(document => rows.push({ ...document.data(), id: document.id }))
  return rows
}

export async function prepareDownloadOwner(uid, assertCurrent) {
  return db.transaction('rw', db.settings, async () => {
    assertCurrent()
    const owner = (await db.settings.get(OWNER))?.value
    let epoch = (await db.settings.get(EPOCH))?.value || 0
    // The current local note cache is shared: account switches must rebuild its download frontier.
    if (owner !== uid) {
      await db.settings.where('key').startsWith(PREFIX).delete()
      epoch++
      await db.settings.bulkPut([{ key: OWNER, value: uid }, { key: EPOCH, value: epoch }])
    }
    assertCurrent()
    return epoch
  })
}

export async function assertDownloadEpoch(epoch) {
  if (((await db.settings.get(EPOCH))?.value || 0) !== epoch) throw new Error('本机数据已经改变，正在重新建立同步断点')
}

export async function invalidateDownloadState() {
  return db.transaction('rw', db.settings, async () => {
    const epoch = (await db.settings.get(EPOCH))?.value || 0
    await db.settings.where('key').startsWith(PREFIX).delete()
    await db.settings.put({ key: EPOCH, value: epoch + 1 })
  })
}

export function deltaQuery(api, reference, cursor, after = null, pageSize = null) {
  const base = cursor || zero()
  const constraints = [api.where('serverUpdatedAt', '>=', timestamp(base)),
    api.orderBy('serverUpdatedAt', 'asc'), api.orderBy(api.documentId(), 'asc')]
  if (after) constraints.push(api.startAfter(timestamp(after), after.id))
  if (pageSize) constraints.push(api.limit(pageSize))
  return api.query(reference, ...constraints)
}

export async function pullCollection({ api, reference, uid, kind, epoch, assertCurrent, commitPage }) {
  const key = cursorKey(uid, kind)
  let state = (await db.settings.get(key))?.value
  assertCurrent()
  if (!state || state.epoch !== epoch) {
    const latest = await api.getDocs(api.query(reference,
      api.orderBy('serverUpdatedAt', 'desc'), api.orderBy(api.documentId(), 'desc'), api.limit(1)))
    assertCurrent()
    const watermark = serverRecords(latest).map(documentCursor).find(Boolean) || zero()
    state = { epoch, phase: 'bootstrap', afterId: null, seenIds: [], baseline: watermark }
    await commitPage([], key, state, null)
  }
  const seen = new Set()
  while (true) {
    assertCurrent()
    let target
    const bootstrap = state.phase === 'bootstrap'
    const base = state.delta?.base || state.cursor || zero()
    if (bootstrap) {
      const constraints = [api.orderBy(api.documentId(), 'asc')]
      if (state.afterId) constraints.push(api.startAfter(state.afterId))
      constraints.push(api.limit(SYNC_PAGE_SIZE))
      // No timestamp filter here: legacy records without serverUpdatedAt must be included.
      target = api.query(reference, ...constraints)
    } else target = deltaQuery(api, reference, base, state.delta?.after, SYNC_PAGE_SIZE)
    const snapshot = await api.getDocs(target)
    assertCurrent()
    const rows = serverRecords(snapshot)
    for (const row of rows) seen.add(row.id)
    const next = { ...state }
    let fullIds = null
    if (bootstrap) {
      next.seenIds = [...state.seenIds, ...rows.map(row => row.id)]
      next.afterId = rows.at(-1)?.id || state.afterId
      if (rows.length < SYNC_PAGE_SIZE) {
        fullIds = next.seenIds
        next.phase = 'incremental'
        next.cursor = state.baseline
        delete next.seenIds; delete next.afterId; delete next.baseline
      }
    } else {
      let cursor = state.cursor || zero()
      for (const row of rows) cursor = newestCursor(cursor, documentCursor(row))
      next.cursor = cursor
      if (rows.length === SYNC_PAGE_SIZE) {
        const after = documentCursor(rows.at(-1))
        if (!after) throw new Error('云端记录缺少有效的服务端更新时间，未推进同步断点')
        next.delta = { base, after }
      } else next.delta = null
    }
    // The caller commits merges and this checkpoint in one guarded IndexedDB transaction.
    await commitPage(rows, key, next, fullIds)
    state = next
    if (!bootstrap && !state.delta) return { documents: seen.size, cursor: state.cursor }
  }
}

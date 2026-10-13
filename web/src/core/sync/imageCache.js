import { db } from '../db/database.js'

const objectUrls = new Map()
const inFlight = new Map()
export function releaseImageUrls() {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url)
  objectUrls.clear()
}
export async function cachedImageUrl(src, owner, resolveDownloadUrl) {
  if (!owner || !src.startsWith('https://lightnote.attachments/')) return resolveDownloadUrl()
  const key = `${owner}:${src}`
  if (objectUrls.has(key)) return objectUrls.get(key)
  if (inFlight.has(key)) return inFlight.get(key)
  const job = (async () => {
    const cached = await db.image_cache.get(key)
    let blob = cached?.blob
    if (!blob) {
      const downloadUrl = await resolveDownloadUrl()
      if (downloadUrl === src) return src
      const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error(`图片下载失败（${response.status}）`)
      blob = await response.blob()
      await db.image_cache.put({ key, owner_uid: owner, src, blob, last_accessed: Date.now() })
    }
    const url = URL.createObjectURL(blob)
    objectUrls.set(key, url)
    return url
  })()
  inFlight.set(key, job)
  try { return await job } finally { inFlight.delete(key) }
}

import { db } from '../db/database.js'
import { downloadImageBlob } from './imageDownload.js'

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
      blob = await downloadImageBlob(downloadUrl)
      // A full cache must not prevent an otherwise downloaded image from displaying.
      await db.image_cache.put({ key, owner_uid: owner, src, blob, last_accessed: Date.now() })
        .catch(error => console.warn('图片缓存未写入:', error.name))
    }
    const url = URL.createObjectURL(blob)
    objectUrls.set(key, url)
    return url
  })()
  inFlight.set(key, job)
  try { return await job } finally { inFlight.delete(key) }
}

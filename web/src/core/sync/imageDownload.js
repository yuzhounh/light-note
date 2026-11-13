import { Capacitor, CapacitorHttp } from '@capacitor/core'

export function nativeImageBlob(response) {
  if (response.status < 200 || response.status >= 300) throw new Error(`图片下载失败（${response.status}）`)
  const type = Object.entries(response.headers || {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1]?.split(';')[0]
  if (!type?.startsWith('image/') || typeof response.data !== 'string') throw new Error('图片响应格式无效')
  const bytes = Uint8Array.from(atob(response.data), char => char.charCodeAt(0))
  if (!bytes.length) throw new Error('图片内容为空')
  return new Blob([bytes], { type })
}

export async function downloadImageBlob(url, nativeGet = options => CapacitorHttp.get(options)) {
  if (Capacitor.getPlatform() === 'android') {
    // Storage media may omit CORS headers even though its metadata and image URL work.
    // Use the existing native HTTP helper only here; leave Firebase's web transport intact.
    return nativeImageBlob(await nativeGet({
      url, responseType: 'arraybuffer', shouldEncodeUrlParams: false,
      connectTimeout: 15000, readTimeout: 30000,
    }))
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`图片下载失败（${response.status}）`)
  return response.blob()
}

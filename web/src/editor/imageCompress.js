// 插入图片前压缩，规则与桌面端一致：
// 手机截屏缩到 50% 宽度，其他图片长边最多 2560 像素；照片转 JPEG，大的无透明 PNG 在更小时转 WebP。
// 无法处理、动图或压缩后更大时保留原图。

const SKIP_BELOW_BYTES = 200 * 1024
const MAX_LONG_EDGE = 2560
const PHONE_SCREENSHOT_MAX_WIDTH = 1500
const PHONE_SCREENSHOT_MIN_ASPECT = 1.9
const JPEG_QUALITY = 0.82
const WEBP_QUALITY = 0.85
const PNG_TO_WEBP_THRESHOLD_BYTES = 500 * 1024

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function computeScale(width, height) {
  if (height >= width * PHONE_SCREENSHOT_MIN_ASPECT && width <= PHONE_SCREENSHOT_MAX_WIDTH) {
    return 0.5
  }
  const longEdge = Math.max(width, height)
  return longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1
}

function canvasToBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob && blob.type === type ? blob : null), type, quality))
}

function hasTransparency(ctx, width, height) {
  const { data } = ctx.getImageData(0, 0, width, height)
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true
  }
  return false
}

async function compressBlob(file) {
  if (file.size < SKIP_BELOW_BYTES) return null
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return null

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const scale = computeScale(bitmap.width, bitmap.height)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.imageSmoothingQuality = 'high'

    let best = null
    if (file.type === 'image/jpeg') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(bitmap, 0, 0, width, height)
      best = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY)
    } else if (file.type === 'image/webp') {
      ctx.drawImage(bitmap, 0, 0, width, height)
      best = await canvasToBlob(canvas, 'image/webp', WEBP_QUALITY)
    } else {
      ctx.drawImage(bitmap, 0, 0, width, height)
      best = await canvasToBlob(canvas, 'image/png')
      if (best && best.size > PNG_TO_WEBP_THRESHOLD_BYTES && !hasTransparency(ctx, width, height)) {
        const webp = await canvasToBlob(canvas, 'image/webp', WEBP_QUALITY)
        if (webp && webp.size < best.size) best = webp
      }
    }
    return best && best.size < file.size ? best : null
  } finally {
    bitmap.close()
  }
}

// 返回可直接作为 <img src> 的 data URL；压缩失败时回退为原图。
export async function imageFileToDataUrl(file) {
  try {
    const compressed = await compressBlob(file)
    return await readAsDataUrl(compressed || file)
  } catch {
    return readAsDataUrl(file)
  }
}

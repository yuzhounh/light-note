// 插入图片前压缩，规则与桌面端一致：
// PNG/WebP 截图保留原文件和像素尺寸；JPEG 照片长边最多 3200、质量 90。
// 无法处理、动图或没有体积收益时保留原图；超大 JPEG 始终应用尺寸上限。
import { initialImageSize } from '../../../editor/src/imageSizing.js'

const SKIP_BELOW_BYTES = 200 * 1024
const MAX_LONG_EDGE = 3200
const JPEG_QUALITY = 0.90

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function computeScale(width, height) {
  const longEdge = Math.max(width, height)
  return longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1
}

function canvasToBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob && blob.type === type ? blob : null), type, quality))
}

async function compressBlob(file) {
  if (file.type !== 'image/jpeg') return null

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const scale = computeScale(bitmap.width, bitmap.height)
    if (file.size < SKIP_BELOW_BYTES && scale === 1) return null
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.imageSmoothingQuality = 'high'

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    const best = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY)
    return best && (scale < 1 || best.size < file.size) ? best : null
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

export async function imageFileToImageAttributes(file) {
  const src = await imageFileToDataUrl(file)
  const image = new window.Image()
  const dimensions = await new Promise(resolve => {
    image.onload = () => resolve([image.naturalWidth, image.naturalHeight])
    image.onerror = () => resolve([0, 0])
    image.src = src
  })
  return { src, ...initialImageSize(...dimensions, window.devicePixelRatio || 1) }
}

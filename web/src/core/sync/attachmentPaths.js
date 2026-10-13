export const ATTACHMENT_URL_PREFIX = 'https://lightnote.attachments/'

export function normalizeAttachmentPath(path = '') {
  return (typeof path === 'string' ? path : '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
}

export async function findAttachmentCloudPath(attachments, src, uid) {
  const relativePath = normalizeAttachmentPath(src.slice(ATTACHMENT_URL_PREFIX.length))
  const attachment = await attachments.where('relative_path').equals(relativePath).first()
  if (attachment?.cloud_path) return attachment.cloud_path
  const filename = relativePath.split('/').pop()
  const sha256 = filename.split('.')[0]
  return `users/${uid}/attachments/${sha256}/${filename}`
}

// 笔记详情：字数统计与时间格式（桌面端 NoteInfoFormatter 的网页版）

// 中日韩文字每个算一个，连续的字母或数字算一个词，标点与空白不计
export function countWords(text) {
  if (!text) return 0
  const matches = text.match(/[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]|[\p{L}\p{N}]+/gu)
  return matches ? matches.length : 0
}

export function formatInfoTime(isoString) {
  if (!isoString) return '-'
  const d = new Date(isoString)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

import { db } from './database.js'
import { invalidateDownloadState } from '../sync/syncCursor.js'

// 备份导出 / 导入（JSON），供设置弹窗之外的入口复用
export async function exportBackup() {
  const notebooks = await db.notebooks.toArray()
  const notes = await db.notes.toArray()
  const backupData = { version: '1.0', exported_at: new Date().toISOString(), notebooks, notes }
  const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `LightNote_Backup_${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export async function importBackup(file) {
  const data = JSON.parse(await file.text())
  if (!Array.isArray(data.notebooks) || !Array.isArray(data.notes)) {
    throw new Error('无效的 LightNote 备份文件格式。')
  }
  await db.transaction('rw', db.notebooks, db.notes, db.settings, async () => {
    await db.notebooks.bulkPut(data.notebooks)
    await db.notes.bulkPut(data.notes)
    await invalidateDownloadState()
  })
  return { notebooks: data.notebooks.length, notes: data.notes.length }
}

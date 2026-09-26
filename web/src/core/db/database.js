import Dexie from 'dexie'

export class LightNoteDatabase extends Dexie {
  constructor() {
    super('LightNoteDB')
    
    this.version(1).stores({
      notebooks: 'id, name, group_id, sort_order, updated_at, deleted_at',
      notes: 'id, notebook_id, title, is_pinned, is_deleted, sort_order, updated_at, deleted_at',
      tags: 'id, name',
      note_tags: '[note_id+tag_id], note_id, tag_id',
      attachments: 'sha256, filename, byte_size, created_at',
      sync_outbox: '++id, entity_type, entity_id, action, created_at',
      settings: 'key'
    })
  }
}

export const db = new LightNoteDatabase()

/**
 * Seed initial sample notebook and note if database is empty
 */
export async function seedInitialData() {
  const notebookCount = await db.notebooks.count()
  if (notebookCount > 0) return

  const now = new Date().toISOString()
  const defaultNotebookId = crypto.randomUUID()

  await db.notebooks.add({
    id: defaultNotebookId,
    name: '默认笔记本',
    group_id: null,
    sort_order: 1,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  })

  const sampleNoteId = crypto.randomUUID()
  await db.notes.add({
    id: sampleNoteId,
    notebook_id: defaultNotebookId,
    title: '欢迎使用 LightNote 网页与移动端',
    body_html: `
      <h2>🚀 欢迎体验 LightNote 跨平台端</h2>
      <p>这是一个专为桌面网页、平板与手机打造的<strong>轻量、响应式笔记</strong>。</p>
      <ul>
        <li><strong>本地优先</strong>：所有输入内容即时保存至浏览器本地数据库（IndexedDB），离线安全可用。</li>
        <li><strong>数学公式</strong>：支持 KaTeX 渲染，例如质能方程 <span class="math-node" data-latex="E = mc^2">E = mc^2</span>。</li>
        <li><strong>跨端协同</strong>：支持与 Windows 客户端同步 Firestore 云端数据。</li>
      </ul>
      <p>点击上方工具栏或键盘快捷栏，即刻开始畅快记录！</p>
    `,
    body_text: '欢迎体验 LightNote 跨平台端。这是一个专为桌面网页、平板与手机打造的轻量、响应式笔记。',
    is_pinned: 1,
    is_deleted: 0,
    sort_order: 1,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  })
}

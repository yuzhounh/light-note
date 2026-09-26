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
 * Seed initial notebooks and notes matching LightNote desktop screenshot
 */
export async function seedInitialData() {
  const count = await db.notebooks.count()
  if (count > 0) return

  const now = new Date().toISOString()
  const nbDefaultId = crypto.randomUUID()
  const nbDevId = crypto.randomUUID()

  await db.notebooks.bulkAdd([
    {
      id: nbDefaultId,
      name: '默认',
      group_id: null,
      sort_order: 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
    {
      id: nbDevId,
      name: 'LightNote 开发记录',
      group_id: null,
      sort_order: 2,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }
  ])

  const note1Id = crypto.randomUUID()
  const note2Id = crypto.randomUUID()
  const note3Id = crypto.randomUUID()
  const note4Id = crypto.randomUUID()

  await db.notes.bulkAdd([
    {
      id: note1Id,
      notebook_id: nbDefaultId,
      title: '具身智能',
      body_html: `
        <p>具身智能（机器人进入物理实验室操作移液枪、离心机、配试剂）确实能极大拓展 AI 的物理执行半径，但<strong>实验学科的本质瓶颈在于“闭环验证与反馈”的速度和信噪比</strong>，而具身智能只是实现自动化的物理形态之一，<strong>并非不可替代的前提</strong>。</p>
        <p>结合当前知乎讨论与 AI4S（AI for Science）在实验学科的发展现状，这一问题可以从以下几个维度来看：</p>
        <h3>1. 自动化流水线（Cloud Lab）早已先行一步，不一定非要“人形/具身智能”</h3>
        <p>在许多化学合成、高通量材料筛选和分子生物学实验室中，闭环实验早已通过<strong>无具身形态的专用自动化工作站</strong>（如机械臂、微流控芯片、自动移液机、自动化学合成仪等）展开：</p>
        <ul>
          <li><strong>结构化实验环境</strong>：工业界和顶尖科研机构更倾向于把实验流程“标准化、模块化”，用代码控制 API 和固定管路，这比训练一个通用视觉-力控的具身机器人去拿玻璃器皿要稳定、可重复得多。</li>
          <li><strong>软件定义实验</strong>：AI 提出假说或分子候选 转化为自动化脚本 机械流水线执行 质谱/光谱/测序仪自动读数并回传数据。这种循环在几年前就已经落地，不需要等待具身智能完全成熟。</li>
        </ul>
        <h3>2. 具身智能真正能解决的痛点：长尾、复杂与非标实验</h3>
        <p>之所以大家会期待具身智能，是因为现有自动化设备的局限：</p>
        <ul>
          <li><strong>跨设备与非标操作</strong>：很多前沿实验（如复杂小鼠手术、柔性样品转移、非常规装置搭建）无法被标准化机台取代，依然极度依赖人类实验员的“手感”和临场反应。</li>
        </ul>
      `,
      body_text: '具身智能（机器人进入物理实验室操作移液枪、离心机、配试剂）确实能极大拓展 AI 的物理执行半径，但实验学科的本质瓶颈在于“闭环验证与反馈”的速度和信噪比...',
      is_pinned: 1,
      is_deleted: 0,
      sort_order: 1,
      created_at: '2026-09-25T10:02:00.000Z',
      updated_at: '2026-09-25T10:02:00.000Z',
      deleted_at: null,
    },
    {
      id: note2Id,
      notebook_id: nbDefaultId,
      title: 'AI 模型发布日报 | 9月24日',
      body_html: '<p>AI 模型发布日报 | 9 月 24 日 过去约 24 小时内，1 项模型层面的重要进展值得关注：小米 MiMo: MiMo-V3 核心架构演进与全量实测。</p>',
      body_text: 'AI 模型发布日报 | 9 月 24 日 过去约 24 小时内，1 项模型层面的重要进展值得关注：小米 MiMo: MiMo-V3 核心架...',
      is_pinned: 0,
      is_deleted: 0,
      sort_order: 2,
      created_at: '2026-09-25T09:55:00.000Z',
      updated_at: '2026-09-25T09:55:00.000Z',
      deleted_at: null,
    },
    {
      id: note3Id,
      notebook_id: nbDevId,
      title: '开发计划',
      body_html: '<p>2026-09-19 14:33:03 1，写了标题后，tab 键应该进入正文。2，配置 Google Firebase。3，软件名称改为 LightNote 并支持 PWA 与 Android 跨平台适配。</p>',
      body_text: '2026-09-19 14:33:03 1，写了标题后，tab 键应该进入正文。2，配置 Google Firebase。3，软件名称改为 Note...',
      is_pinned: 0,
      is_deleted: 0,
      sort_order: 3,
      created_at: '2026-09-25T09:02:00.000Z',
      updated_at: '2026-09-25T09:02:00.000Z',
      deleted_at: null,
    },
    {
      id: note4Id,
      notebook_id: nbDevId,
      title: 'V1.6: 交互细节统一',
      body_html: '<p>版本定位：收口账户卡片、设置中心、分栏拖动和笔记列表的信息表达，让常用入口保持一致、清晰且易于操作。</p>',
      body_text: '版本定位：收口账户卡片、设置中心、分栏拖动和笔记列表的信息表达，让常用入口保持一致、清晰且易于操作。主要修改包括...',
      is_pinned: 0,
      is_deleted: 0,
      sort_order: 4,
      created_at: '2026-09-19T14:42:00.000Z',
      updated_at: '2026-09-19T14:42:00.000Z',
      deleted_at: null,
    }
  ])
}

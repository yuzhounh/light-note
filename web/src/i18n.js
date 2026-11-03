// Lightweight bilingual (Simplified Chinese / English) runtime for LightNote
// web. Installs a DOM overlay translating matching Chinese text/attributes at
// runtime (and via MutationObserver), restoring Chinese on switch back.
// Default Simplified Chinese; choice stored in localStorage, switched from the
// Settings modal.

const STORAGE_KEY = 'lightnote_lang'

const DICT = {
  '界面语言': 'Language',
  '切换为英文': 'Switch to English',
  '切换为中文': 'Switch to Chinese',
  '切换中英文 (L)': 'Switch language (L)',
  '简体中文': 'Simplified Chinese',
  '字数统计：': 'Word count: ',
  '创建于 ': 'Created at ',
  '编辑于 ': 'Edited at ',
  '确定将该笔记移入回收站？': 'Move this note to trash?',
  '移入回收站': 'Move to trash',
  '历史版本': 'History versions',
  '查看或恢复历史版本': 'View or restore history versions',
  '点击重试': 'Click to retry',
  '返回': 'Back',
  '斜体': 'Italic',
  '加粗': 'Bold',

  '语言 / Language': 'Language',
  '设置': 'Settings',
  '设置中心': 'Settings',
  '关闭设置': 'Close settings',
  '关闭': 'Close',
  '关闭菜单': 'Close menu',
  '快捷设置与导航': 'Quick settings and navigation',
  '外观': 'Appearance',
  '外观主题': 'Theme',
  '浅色': 'Light',
  '深色': 'Dark',
  '浅色模式': 'Light mode',
  '深色模式': 'Dark mode',
  '标准明亮界面': 'Standard bright interface',
  '暗色护眼界面': 'Dark, eye-friendly interface',
  '选择浅色明亮或深色护眼外观。': 'Choose a light, bright look or a dark, eye-friendly look.',
  '切换为浅色主题': 'Switch to light theme',
  '切换为深色主题': 'Switch to dark theme',
  '切换外观主题': 'Toggle theme',
  'Markdown 自动排版': 'Markdown auto-format',
  '数据与备份': 'Data & backup',
  '本地数据备份': 'Local data backup',
  '导出或还原笔记本与笔记数据，管理本地存储。': 'Export or restore notebook and note data, and manage local storage.',
  '导出为单个标准 JSON 格式，可随时还原或导入 Windows 桌面版。': 'Export as a single standard JSON file; restore anytime or import into the Windows desktop version.',
  '导出全部笔记 (JSON)': 'Export all notes (JSON)',
  '导出备份': 'Export backup',
  '导入备份': 'Import backup',
  '导入备份文件': 'Import backup file',
  '存储清理': 'Storage cleanup',
  '清空回收站': 'Empty trash',
  '清空': 'Clear',
  '回收站': 'Trash',
  '回收站是空的': 'Trash is empty',
  '回收站已清空': 'Trash emptied',
  '回收站已清空。': 'Trash emptied.',
  '确定清空回收站中的所有笔记吗？此操作无法撤销。': 'Empty all notes in the trash? This cannot be undone.',
  '将彻底删除回收站中的全部笔记，此操作无法撤销。': 'All notes in the trash will be permanently deleted. This cannot be undone.',
  '全部笔记': 'All notes',
  '笔记本': 'Notebook',
  '笔记本组': 'Notebook group',
  '笔记本名': 'Notebook name',
  '笔记本名称': 'Notebook name',
  '笔记本与列表': 'Notebooks & lists',
  '笔记本与设置': 'Notebooks & settings',
  '笔记信息': 'Note info',
  '新建笔记': 'New note',
  '新建笔记本': 'New notebook',
  '创建笔记本': 'Create notebook',
  '删除笔记本': 'Delete notebook',
  '重命名笔记本': 'Rename notebook',
  '重命名': 'Rename',
  '取消新建笔记本': 'Cancel new notebook',
  '菜单': 'Menu',
  '更多': 'More',
  '保存': 'Save',
  '删除': 'Delete',
  '彻底删除': 'Delete permanently',
  '移入回收站': 'Move to trash',
  '恢复': 'Restore',
  '取消': 'Cancel',
  '确定': 'OK',
  '好': 'OK',
  '上移': 'Move up',
  '下移': 'Move down',
  '移动': 'Move',
  '全选': 'Select all',
  '取消全选': 'Deselect all',
  '已选择': 'Selected',
  '未选择': 'None selected',
  '未归类': 'Uncategorized',
  '无标题': 'Untitled',
  '无附加正文...': 'No extra content...',
  '清除搜索': 'Clear search',
  '搜索标题和正文': 'Search title and content',
  '搜索标题和正文...': 'Search title and content...',
  '搜索结果': 'Search results',
  '搜索与批量操作': 'Search & bulk actions',
  '没有找到匹配的笔记': 'No matching notes',
  '还没有笔记，点右下角的 + 新建': 'No notes yet — tap + at the bottom-right to create one',
  '还没有笔记本，请先在菜单中新建。': 'No notebooks yet — create one from the menu first.',
  '创建时间': 'Created',
  '修改时间': 'Modified',
  '按创建时间': 'By creation time',
  '按修改时间': 'By modified time',
  '排序方式': 'Sort by',
  '顺序': 'Order',
  '逆序': 'Reverse',
  '逆序（新的在前）': 'Reverse (newest first)',
  '卡片密度': 'Card density',
  '紧凑': 'Compact',
  '舒适': 'Comfortable',
  '宽松': 'Loose',
  '历史版本': 'History',
  '历史版本与回收站': 'History & trash',
  '新建与编辑': 'Create & edit',
  '使用说明': 'Help',
  '登录与同步': 'Sign in & sync',
  '登录 Google 账号': 'Sign in with Google',
  'Google 登录': 'Google sign-in',
  '退出登录': 'Sign out',
  '已登录': 'Signed in',
  '已同步': 'Synced',
  '正在同步': 'Syncing',
  '正在同步...': 'Syncing...',
  '同步异常': 'Sync error',
  '点击管理账号': 'Manage account',
  'LightNote 用户': 'LightNote user',
  '已彻底删除': 'Permanently deleted',
  '已导出备份': 'Backup exported',
  '导出成功！': 'Export succeeded!',
  '已恢复': 'Restored',
  '已移动': 'Moved',
  '已移入回收站': 'Moved to trash',
  '导出失败：': 'Export failed: ',
  '导入失败：': 'Import failed: ',
  '导入失败：无效的 LightNote 备份文件格式。': 'Import failed: invalid LightNote backup format.',
  '解析文件失败：': 'Failed to parse file: ',
  '确定将该笔记恢复到所选版本？当前内容会先保存为一个历史版本。': 'Restore this note to the selected version? The current content will first be saved as a history version.',
  '当前网站域名尚未加入 Firebase 授权域名。': 'This site domain is not yet an authorized Firebase domain.',
  '登录窗口已关闭，请重新尝试。': 'The sign-in window was closed. Please try again.',
  '浏览器阻止了登录窗口，请允许本站弹出窗口后重试。': 'The browser blocked the sign-in window. Please allow pop-ups for this site and try again.',
  '网络连接失败，请检查网络后重试。': 'Network connection failed. Check your network and try again.',
  '已取消 Google 登录。': 'Google sign-in cancelled.',
  '手机系统未能完成 Google 登录，请检查 Google Play 服务和网络后重试。': 'The phone system could not complete Google sign-in. Check Google Play services and network, then try again.',
  '输入 1. 、# 、- 、&gt; 、**粗体**、$公式$ 等符号时自动转换为列表、标题、引用、粗体、公式。关闭后这些符号按原样输入，工具栏和快捷键仍可使用。':
    'Typing 1. , # , - , &gt; , **bold**, $formula$ etc. auto-converts to lists, headings, quotes, bold and formulas. When off, these symbols are entered literally; the toolbar and shortcuts still work.',
  '此 JSON 备份不包含历史版本和独立图片文件；笔记中的图片引用会保留，恢复后的图片显示仍取决于原图片是否可访问。':
    'This JSON backup does not include history versions or standalone image files; image references in notes are kept, but display after restore depends on whether the original images are accessible.',
  '导出与导入备份': 'Export & import backup',
  '开': 'On',
  '关': 'Off',
}

const origText = new WeakMap()
const origAttr = new WeakMap()

export function getLang() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

function pad(original, replacement) {
  const lead = (original.match(/^\s*/) || [''])[0]
  const trail = (original.match(/\s*$/) || [''])[0]
  return lead + replacement + trail
}

function processText(node, en) {
  const parent = node.parentNode
  if (parent) {
    const tag = parent.nodeName
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return
  }
  if (origText.has(node)) {
    const original = origText.get(node)
    if (en) {
      const key = original.trim()
      if (Object.prototype.hasOwnProperty.call(DICT, key)) node.nodeValue = pad(original, DICT[key])
    } else {
      node.nodeValue = original
      origText.delete(node)
    }
    return
  }
  if (!en) return
  const current = node.nodeValue
  const key = current ? current.trim() : ''
  if (!key || !Object.prototype.hasOwnProperty.call(DICT, key)) return
  origText.set(node, current)
  node.nodeValue = pad(current, DICT[key])
}

function processAttr(el, en) {
  ['placeholder', 'title', 'aria-label', 'alt'].forEach((attr) => {
    if (!el.hasAttribute(attr)) return
    let map = origAttr.get(el)
    if (!map) {
      map = new Map()
      origAttr.set(el, map)
    }
    if (!map.has(attr)) map.set(attr, el.getAttribute(attr) || '')
    const original = map.get(attr) || ''
    const key = original.trim()
    if (en && Object.prototype.hasOwnProperty.call(DICT, key)) el.setAttribute(attr, DICT[key])
    else el.setAttribute(attr, original)
  })
}

function walk(root, en) {
  if (!root) return
  if (root.nodeType === 3) {
    processText(root, en)
    return
  }
  if (root.nodeType !== 1 && root.nodeType !== 11) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let n
  while ((n = walker.nextNode())) processText(n, en)
  if (root.nodeType === 1) processAttr(root, en)
  const els = root.querySelectorAll ? root.querySelectorAll('[placeholder],[title],[aria-label],[alt]') : []
  els.forEach((el) => processAttr(el, en))
}

function applyAll() {
  if (typeof document === 'undefined' || !document.body) return
  walk(document.body, getLang() === 'en')
}

export function setLang(lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'
  applyAll()
  window.dispatchEvent(new CustomEvent('lightnote:lang-changed', { detail: lang }))
}

let started = false
function start() {
  if (started || typeof document === 'undefined' || !document.body) return
  started = true
  applyAll()
  document.documentElement.lang = getLang() === 'en' ? 'en' : 'zh-CN'
  const observer = new MutationObserver((mutations) => {
    const en = getLang() === 'en'
    for (const mutation of mutations) {
      if (mutation.type === 'childList') mutation.addedNodes.forEach((node) => walk(node, en))
      else if (mutation.type === 'characterData') processText(mutation.target, en)
    }
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
else start()

window.LightNoteI18N = { getLang, setLang }

// 外部粘贴后追加“来源：…”一行。
// 来源由桌面端从系统剪贴板读取：浏览器复制的内容是网页链接，其他软件复制的内容是软件名。

/** 在 pos 所在的顶层块之后插入来源段落；已有相同来源时不重复插入。返回是否插入。 */
export function insertSourceLine(editor, pos, source) {
  const label = source?.label?.trim()
  if (!label) return false

  const { state } = editor
  const clamped = Math.max(0, Math.min(pos, state.doc.content.size))
  const $pos = state.doc.resolve(clamped)
  const insertAt = $pos.depth >= 1 ? $pos.after(1) : clamped

  const text = `来源：${label}`
  const next = state.doc.resolve(insertAt).nodeAfter
  if (next?.textContent === text) return false

  const linkType = state.schema.marks.link
  const content = [{ type: 'text', text: '来源：' }]
  content.push(source.url && linkType
    ? { type: 'text', text: label, marks: [{ type: 'link', attrs: { href: source.url } }] }
    : { type: 'text', text: label })

  return editor
    .chain()
    .insertContentAt(insertAt, { type: 'paragraph', content }, { updateSelection: false })
    .run()
}

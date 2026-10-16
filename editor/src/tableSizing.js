// Shared by the Tiptap 3 desktop editor and Tiptap 2 web editor. Dependencies are
// supplied by each editor so their ProseMirror instances are never mixed.
export const DEFAULT_TABLE_WIDTH = 900
const LEGACY_DEFAULT_TABLE_WIDTH = 1080
export const MIN_COLUMN_WIDTH = 80

const validWidth = value => Number.isFinite(Number(value)) && Number(value) > 0

function tableWidthMode(node) {
  if (node.attrs.tableWidthMode) return node.attrs.tableWidthMode
  // Older LightNote tables stored their default total without an origin flag.
  if (Number(node.attrs.tableWidth) === LEGACY_DEFAULT_TABLE_WIDTH) return 'default'
  let hasWidth = false
  node.forEach(row => row.forEach(cell => {
    if (cell.attrs.colwidth?.some(validWidth)) hasWidth = true
  }))
  return validWidth(node.attrs.tableWidth) || hasWidth ? 'fixed' : 'default'
}

function scaleWidths(widths, total) {
  const previousTotal = widths.reduce((sum, width) => sum + width, 0)
  let previousEdge = 0
  let nextEdge = 0
  const scaled = widths.map(width => {
    previousEdge += width
    const edge = Math.round(previousEdge * total / previousTotal)
    const value = Math.max(1, edge - nextEdge)
    nextEdge = edge
    return value
  })
  const widest = scaled.indexOf(Math.max(...scaled))
  scaled[widest] += total - scaled.reduce((sum, width) => sum + width, 0)
  return scaled
}

// A stable cross-platform estimate in layout pixels; don't measure or resize on
// each keystroke. Long outliers are capped and cell padding leaves breathing room.
function contentScores(node, map) {
  const samples = Array.from({ length: map.width }, () => [])
  const headers = Array(map.width).fill(MIN_COLUMN_WIDTH)
  for (const offset of new Set(map.map)) {
    const rect = map.findCell(offset)
    if (rect.right - rect.left !== 1 || rect.top >= 40) continue
    const cell = node.nodeAt(offset)
    let longest = 0
    for (const line of cell.textBetween(0, cell.content.size, '\n').split('\n')) {
      let width = 0
      for (const character of [...line].slice(0, 1000))
        width += /[\u2e80-\uffff]/u.test(character) ? 16 : /\s/u.test(character) ? 4 : /[A-ZMW]/.test(character) ? 10 : 8
      longest = Math.max(longest, width)
    }
    cell.descendants(child => {
      if (child.type.name === 'image') longest = Math.max(longest, 240)
    })
    const score = Math.max(MIN_COLUMN_WIDTH, Math.min(600, longest + 32))
    samples[rect.left].push(score)
    if (cell.type.name === 'tableHeader') headers[rect.left] = Math.max(headers[rect.left], score)
  }
  return samples.map((values, col) => {
    values.sort((a, b) => a - b)
    return Math.max(headers[col], values.length ? values[Math.ceil(values.length * 0.9) - 1] : MIN_COLUMN_WIDTH)
  })
}

export function tableWidths(node, TableMap) {
  const map = TableMap.get(node)
  const widths = Array(map.width).fill(0)
  for (const offset of new Set(map.map)) {
    const cell = node.nodeAt(offset)
    const rect = map.findCell(offset)
    for (let col = rect.left; col < rect.right; col++) {
      const width = cell.attrs.colwidth?.[col - rect.left]
      if (validWidth(width)) widths[col] = Math.max(1, Math.round(Number(width)))
    }
  }
  const missing = widths.filter(width => !width).length
  const known = widths.reduce((sum, width) => sum + width, 0)
  if (missing) {
    const total = validWidth(node.attrs.tableWidth) ? Number(node.attrs.tableWidth) : DEFAULT_TABLE_WIDTH
    let remaining = Math.max(MIN_COLUMN_WIDTH * missing, Math.round(total) - known)
    const scores = contentScores(node, map)
    let pending = widths.map((width, col) => width ? -1 : col).filter(col => col >= 0)
    while (pending.length) {
      const scoreTotal = pending.reduce((sum, col) => sum + scores[col], 0)
      const narrow = pending.filter(col => remaining * scores[col] / scoreTotal < MIN_COLUMN_WIDTH)
      if (narrow.length) {
        for (const col of narrow) { widths[col] = MIN_COLUMN_WIDTH; remaining -= MIN_COLUMN_WIDTH }
        pending = pending.filter(col => !narrow.includes(col))
        continue
      }
      let leftScore = scoreTotal
      for (const col of pending) {
        widths[col] = Math.round(remaining * scores[col] / leftScore)
        remaining -= widths[col]
        leftScore -= scores[col]
      }
      break
    }
  }
  if (tableWidthMode(node) === 'default' && Number(node.attrs.tableWidth) === LEGACY_DEFAULT_TABLE_WIDTH &&
      widths.reduce((sum, width) => sum + width, 0) === LEGACY_DEFAULT_TABLE_WIDTH && widths.length <= DEFAULT_TABLE_WIDTH) {
    return scaleWidths(widths, DEFAULT_TABLE_WIDTH)
  }
  return widths
}

export function tableContext(state, TableMap) {
  const $from = state.selection.$from
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name !== 'table') continue
    const node = $from.node(depth)
    const pos = $from.before(depth)
    const map = TableMap.get(node)
    let col = 0
    if (depth + 2 <= $from.depth) {
      col = map.findCell($from.before(depth + 2) - pos - 1).left
    }
    return { node, pos, map, col, widths: tableWidths(node, TableMap) }
  }
  return null
}

export function writeTableWidths(tr, pos, widths, TableMap) {
  const node = tr.doc.nodeAt(pos)
  if (!node || node.type.name !== 'table') return false
  const map = TableMap.get(node)
  if (widths.length !== map.width || !widths.every(validWidth)) return false
  for (const offset of new Set(map.map)) {
    const cell = node.nodeAt(offset)
    const rect = map.findCell(offset)
    tr.setNodeMarkup(pos + 1 + offset, undefined, {
      ...cell.attrs, colwidth: widths.slice(rect.left, rect.right).map(Math.round),
    })
  }
  tr.setNodeMarkup(pos, undefined, {
    ...node.attrs, tableWidth: widths.reduce((sum, width) => sum + Math.round(width), 0),
    tableWidthMode: widths.reduce((sum, width) => sum + Math.round(width), 0) ===
      tableWidths(node, TableMap).reduce((sum, width) => sum + width, 0) ? tableWidthMode(node) : 'fixed',
  })
  return true
}

export function resizeColumnPair(widths, col, requestedWidth) {
  const result = [...widths]
  if (result.length === 1 && validWidth(requestedWidth)) return [Math.max(MIN_COLUMN_WIDTH, Math.round(Number(requestedWidth)))]
  if (result.length < 2 || col < 0 || col >= result.length || !validWidth(requestedWidth)) return result
  const other = col === result.length - 1 ? col - 1 : col + 1
  const total = result[col] + result[other]
  const minimum = Math.min(MIN_COLUMN_WIDTH, Math.floor(total / 2))
  result[col] = Math.max(minimum, Math.min(total - minimum, Math.round(Number(requestedWidth))))
  result[other] = total - result[col]
  return result
}

export function resizeTableWidths(widths, requestedTotal) {
  if (!widths.length || !widths.every(validWidth) || !Number.isFinite(Number(requestedTotal))) return [...widths]
  const result = [...widths]
  const leadingWidth = widths.slice(0, -1).reduce((sum, width) => sum + width, 0)
  result[result.length - 1] = Math.max(MIN_COLUMN_WIDTH, Math.round(Number(requestedTotal)) - leadingWidth)
  return result
}

export function createSizedTable(Table, TableMap) {
  return Table.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        tableWidth: {
          default: null,
          parseHTML: element => {
            const saved = element.getAttribute('data-table-width')
            const original = element.style.width || element.getAttribute('width') || ''
            return validWidth(saved) ? Math.round(Number(saved))
              : /^\d+(?:\.\d+)?(?:px)?$/.test(original) ? Math.round(parseFloat(original)) : null
          },
          rendered: false,
        },
        tableWidthMode: {
          default: null,
          parseHTML: element => {
            const saved = element.getAttribute('data-table-width-mode')
            if (saved === 'default' || saved === 'fixed') return saved
            if (element.hasAttribute('data-table-width')) return null
            const original = element.style.width || element.getAttribute('width') || ''
            return /^\d+(?:\.\d+)?(?:px)?$/.test(original) ? 'fixed' : null
          },
          rendered: false,
        },
      }
    },
    renderHTML({ node, HTMLAttributes }) {
      const widths = tableWidths(node, TableMap)
      const total = widths.reduce((sum, width) => sum + width, 0)
      return ['table', { ...HTMLAttributes, 'data-table-width': total, 'data-table-width-mode': tableWidthMode(node),
        style: `width: ${total}px; min-width: ${total}px` },
      ['colgroup', ...widths.map(width => ['col', { width, style: `width: ${width}px` }])], ['tbody', 0]]
    },
    addNodeView() {
      return ({ node, getPos }) => {
        const dom = document.createElement('div')
        dom.className = 'tableWrapper'
        const table = dom.appendChild(document.createElement('table'))
        const colgroup = table.appendChild(document.createElement('colgroup'))
        const contentDOM = table.appendChild(document.createElement('tbody'))
        const render = widths => {
          const total = widths.reduce((sum, width) => sum + width, 0)
          table.style.width = `${total}px`
          table.style.minWidth = `${total}px`
          widths.forEach((width, index) => {
            const col = colgroup.children[index] || colgroup.appendChild(document.createElement('col'))
            col.style.width = `${width}px`
          })
          while (colgroup.children.length > widths.length) colgroup.lastChild.remove()
        }
        const api = { getPos, node, render }
        dom.lightnoteTable = api
        render(tableWidths(node, TableMap))
        return {
          dom, contentDOM,
          update(next) {
            if (next.type !== node.type) return false
            api.node = next
            render(tableWidths(next, TableMap))
            return true
          },
          ignoreMutation(mutation) {
            return mutation.type !== 'selection' && dom.contains(mutation.target) && !contentDOM.contains(mutation.target)
          },
        }
      }
    },
  }).configure({ resizable: false })
}

export function createTableSizing({ Extension, Plugin, PluginKey, TextSelection, Decoration, DecorationSet, TableMap, closeHistory = tr => tr }) {
  const key = new PluginKey('lightnoteTableSizing')
  return Extension.create({
    name: 'lightnoteTableSizing',
    priority: 1100,
    addCommands() {
      return {
        setTableColumnWidth: width => ({ state, tr, dispatch }) => {
          const context = tableContext(state, TableMap)
          if (!context || !validWidth(width)) return false
          if (dispatch) writeTableWidths(closeHistory(tr), context.pos, resizeColumnPair(context.widths, context.col, width), TableMap)
          return true
        },
        equalizeTableColumns: () => ({ state, tr, dispatch }) => {
          const context = tableContext(state, TableMap)
          if (!context) return false
          const total = context.widths.reduce((sum, width) => sum + width, 0)
          const widths = context.widths.map((_, index) => Math.round((index + 1) * total / context.widths.length)
            - Math.round(index * total / context.widths.length))
          if (dispatch) writeTableWidths(closeHistory(tr), context.pos, widths, TableMap)
          return true
        },
      }
    },
    addProseMirrorPlugins() {
      let drag = null
      let cleanup = () => {}
      let pendingInitialization = false
      const checked = new WeakSet()
      const initializeWidths = view => {
        if (pendingInitialization || !view.editable) return
        pendingInitialization = true
        queueMicrotask(() => {
          pendingInitialization = false
          if (view.isDestroyed || !view.editable || drag) return
          const tr = view.state.tr
          view.state.doc.descendants((node, pos) => {
            if (node.type.name !== 'table') return true
            if (checked.has(node)) return false
            checked.add(node)
            let missing = false
            node.forEach(row => row.forEach(cell => {
              if (cell.attrs.colwidth?.length !== cell.attrs.colspan || !cell.attrs.colwidth.every(validWidth)) missing = true
            }))
            const widths = tableWidths(node, TableMap)
            const migrated = tableWidthMode(node) === 'default' && Number(node.attrs.tableWidth) === LEGACY_DEFAULT_TABLE_WIDTH &&
              widths.reduce((sum, width) => sum + width, 0) === DEFAULT_TABLE_WIDTH
            if (missing || migrated || !node.attrs.tableWidthMode) writeTableWidths(tr, pos, widths, TableMap)
            return false
          })
          if (tr.docChanged) view.dispatch(tr.setMeta('addToHistory', false))
        })
      }
      const clear = view => {
        cleanup()
        cleanup = () => {}
        if (drag) drag.api.render(tableWidths(drag.api.node, TableMap))
        drag = null
        if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, null))
      }
      return [new Plugin({
        key,
        state: {
          init: () => null,
          apply(tr, value) {
            if (tr.getMeta(key) !== undefined) return tr.getMeta(key)
            return tr.docChanged ? null : value
          },
        },
        props: {
          attributes: state => key.getState(state) ? { class: 'resize-cursor' } : {},
          decorations(state) {
            const active = key.getState(state)
            const node = active && state.doc.nodeAt(active.pos)
            if (!node || node.type.name !== 'table') return null
            const map = TableMap.get(node)
            const widgets = []
            for (const offset of new Set(map.map)) {
              if (map.findCell(offset).right - 1 !== active.col) continue
              const cell = node.nodeAt(offset)
              widgets.push(Decoration.widget(active.pos + 1 + offset + cell.nodeSize - 1, () => {
                const handle = document.createElement('span')
                handle.className = 'column-resize-handle'
                return handle
              }, { key: `column-${offset}` }))
            }
            return DecorationSet.create(state.doc, widgets)
          },
          handleDOMEvents: {
            mousemove(view, event) {
              if (!view.editable || drag) return false
              const cell = event.target.closest?.('td,th')
              const api = cell?.closest('.tableWrapper')?.lightnoteTable
              let active = null
              if (api && view.dom.contains(cell)) {
                const pos = api.getPos()
                const map = TableMap.get(api.node)
                const rect = map.findCell(view.posAtDOM(cell, 0) - pos - 2)
                const bounds = cell.getBoundingClientRect()
                const col = Math.abs(event.clientX - bounds.right) <= 8 ? rect.right - 1
                  : Math.abs(event.clientX - bounds.left) <= 8 ? rect.left - 1 : -1
                if (col >= 0 && col < map.width) active = { pos, col }
              }
              const previous = key.getState(view.state)
              if (active?.pos !== previous?.pos || active?.col !== previous?.col)
                view.dispatch(view.state.tr.setMeta(key, active))
              return false
            },
            mouseleave(view) {
              if (!drag && key.getState(view.state)) view.dispatch(view.state.tr.setMeta(key, null))
              return false
            },
            mousedown(view, event) {
              const active = key.getState(view.state)
              if (!view.editable || !active || event.button !== 0) return false
              const api = event.target.closest?.('.tableWrapper')?.lightnoteTable
              if (!api || api.getPos() !== active.pos) return false
              const widths = tableWidths(api.node, TableMap)
              const map = TableMap.get(api.node)
              view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(active.pos + 2 + map.map[active.col]))))
              view.focus()
              drag = { api, pos: active.pos, col: active.col, widths, startX: event.clientX, doc: view.state.doc }
              const win = view.dom.ownerDocument.defaultView
              const resizedWidths = x => active.col === widths.length - 1
                ? resizeTableWidths(widths, widths.reduce((sum, width) => sum + width, 0) + x - drag.startX)
                : resizeColumnPair(widths, active.col, widths[active.col] + x - drag.startX)
              const move = e => {
                if (!drag) return
                api.render(resizedWidths(e.clientX))
              }
              const finish = e => {
                if (!drag) return
                const finalWidths = resizedWidths(e.clientX)
                const pos = drag.pos
                cleanup()
                cleanup = () => {}
                drag = null
                const tr = view.state.tr.setMeta(key, null)
                writeTableWidths(tr, pos, finalWidths, TableMap)
                view.dispatch(closeHistory(tr))
              }
              const cancel = () => clear(view)
              const escape = e => { if (e.key === 'Escape') { e.preventDefault(); cancel() } }
              cleanup = () => {
                win.removeEventListener('mousemove', move)
                win.removeEventListener('mouseup', finish)
                win.removeEventListener('blur', cancel)
                win.removeEventListener('keydown', escape)
              }
              win.addEventListener('mousemove', move)
              win.addEventListener('mouseup', finish)
              win.addEventListener('blur', cancel)
              win.addEventListener('keydown', escape)
              event.preventDefault()
              return true
            },
          },
        },
        view: view => {
          let wasEditable = view.editable
          initializeWidths(view)
          return {
            update(current, previous) {
              if (drag && (!view.editable || view.state.doc !== drag.doc)) clear(view)
              if (view.state.doc !== previous.doc || view.editable !== wasEditable) initializeWidths(view)
              wasEditable = view.editable
            },
            destroy() { cleanup(); drag = null },
          }
        },
      })]
    },
  })
}

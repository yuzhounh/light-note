import { Extension } from '@tiptap/core'
import { Selection, TextSelection } from '@tiptap/pm/state'

// This page scrolls body while html is fixed. ProseMirror treats body as the window
// and calls window.scrollBy, which cannot move this independent scroll container.
// Run only on its explicit scroll requests, so reading with the wheel stays put.
export function scrollCaretIntoBodyView(view) {
  if (!(view.state.selection instanceof TextSelection)) return false
  const body = view.dom.ownerDocument.body
  const rect = view.coordsAtPos(view.state.selection.head, 1)
  const top = body.getBoundingClientRect().top + body.clientTop
  const bottom = top + body.clientHeight
  const margin = 32
  if (rect.bottom > bottom - margin) body.scrollTop += rect.bottom - bottom + margin
  else if (rect.top < top + margin) body.scrollTop += rect.top - top - margin
  // Keep ProseMirror's handling of nested scroll containers, including wide tables.
  return false
}

// Tab keeps the focus in the note, as in a word processor. List items indent (ListItem runs first)
// and code blocks indent with spaces (CodeBlock option); elsewhere Tab types a tab character.
// Arrow-up from the very start of the note moves to the title, the reverse of Tab in the title.
export const EditingKeys = Extension.create({
  name: 'lightNoteEditingKeys',
  priority: 50,

  addOptions() {
    return { onExitTop: () => {} }
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        // A first list item cannot be indented further; a typed tab would be stray text.
        if (editor.isActive('listItem')) return true
        return editor.commands.command(({ tr }) => {
          tr.insertText('\t')
          return true
        })
      },
      'Shift-Tab': ({ editor }) => {
        const { selection, doc } = editor.state
        if (selection.empty && selection.from > 0 && doc.textBetween(selection.from - 1, selection.from) === '\t') {
          return editor.commands.deleteRange({ from: selection.from - 1, to: selection.from })
        }
        return true
      },
      ArrowUp: ({ editor }) => {
        const { selection, doc } = editor.state
        if (!selection.empty || selection.from !== Selection.atStart(doc).from) return false
        this.options.onExitTop()
        return true
      },
    }
  },
})

function firstFontFamily(value) {
  return value?.split(',')[0].trim().replace(/^["']|["']$/g, '') || null
}

// The font and size at the cursor, for the toolbar boxes. A style chosen for the next typed text
// (stored mark) wins; otherwise the rendered style counts, which also covers headings and code.
export function currentTextStyle(editor) {
  const { state, view } = editor
  const stored = state.storedMarks?.find(mark => mark.type.name === 'textAppearance')
  let fontFamily = stored?.attrs.fontFamily
  let fontSize = stored?.attrs.fontSize
  if (!fontFamily || !fontSize) {
    try {
      let { node } = view.domAtPos(state.selection.from)
      if (node.nodeType !== 1) node = node.parentElement
      const style = getComputedStyle(node)
      fontFamily ||= style.fontFamily
      fontSize ||= style.fontSize
    } catch {
      // The view is not mounted yet.
    }
  }
  const size = Number.parseFloat(fontSize)
  return {
    fontFamily: firstFontFamily(fontFamily),
    fontSize: size ? String(Math.round(size)) : null,
  }
}

// Where a click outside the text (page margins, below the last line) should put the caret:
// the nearest text, as in a word processor. Returns null when the browser handles the click.
export function selectionForMarginClick(view, { clientX, clientY, target }) {
  const { doc } = view.state
  const first = view.dom.firstElementChild?.getBoundingClientRect()
  const last = view.dom.lastElementChild?.getBoundingClientRect()
  if (!first || !last) return Selection.atStart(doc)
  if (clientY > last.bottom) return Selection.atEnd(doc)
  // Between two blocks of the text the browser already placed the caret.
  if (target === view.dom) return null

  const box = view.dom.getBoundingClientRect()
  const hit = view.posAtCoords({
    left: Math.min(Math.max(clientX, box.left + 1), box.right - 1),
    top: Math.min(Math.max(clientY, first.top + 1), last.bottom - 1),
  })
  return hit ? Selection.near(doc.resolve(hit.pos)) : null
}

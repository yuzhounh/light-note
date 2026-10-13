import { createDocument } from '@tiptap/core'
import { EditorState, Selection } from '@tiptap/pm/state'

// Installs the document through a fresh EditorState. Unlike setContent this is not an undo step
// and it drops the previous undo history, so Ctrl+Z can never bring back another note's content.
function resetDocument(editor, doc, cursor) {
  const selection = cursor == null
    ? Selection.atStart(doc)
    : Selection.near(doc.resolve(Math.min(cursor, doc.content.size)))
  editor.view.updateState(EditorState.create({ doc, plugins: editor.state.plugins, selection }))
}

/**
 * Shows a note sent by the host and reports what happened:
 * - 'loaded': another note was opened (fresh undo history, cursor at the start).
 * - 'unchanged': the open note was sent again with the same content, as after every sync;
 *   undo history and cursor stay as they are.
 * - 'kept': the open note was sent again while it has edits the host has not received yet;
 *   those edits are newer, so they stay and are saved on the next snapshot.
 * - 'replaced': the open note changed elsewhere (sync from another device, history restore).
 */
export function applyNoteContent(editor, html, { sameNote, hasUnsentChanges }) {
  if (sameNote && html === editor.getHTML()) return 'unchanged'
  if (sameNote && hasUnsentChanges) return 'kept'

  // Saved notes are documents, not external clipboard content. Clipboard cleanup would
  // remove blank list items/repeated line breaks and reinterpret literal formula text.
  const doc = createDocument(html || '<p></p>', editor.schema)
  if (!sameNote) {
    resetDocument(editor, doc)
    return 'loaded'
  }
  if (doc.eq(editor.state.doc)) return 'unchanged'
  resetDocument(editor, doc, editor.state.selection.from)
  return 'replaced'
}

export function clearDocument(editor) {
  resetDocument(editor, createDocument('<p></p>', editor.schema))
}

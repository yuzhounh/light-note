import { getHTMLFromFragment, getText, getTextSerializersFromSchema } from '@tiptap/core'

/**
 * A keystroke keeps only the editor's immutable document. HTML, text and JSON are produced on first read
 * (autosave, word count, list preview) and cached, with the same output as editor.getHTML()/getText()/getJSON().
 */
export function contentSnapshot(editor) {
  const doc = editor.state.doc, schema = editor.schema
  let html, text, json
  return {
    doc,
    get html() { return html ??= getHTMLFromFragment(doc.content, schema) },
    get text() {
      return text ??= getText(doc, { blockSeparator: '\n\n', textSerializers: getTextSerializersFromSchema(schema) })
    },
    get json() { return json ??= doc.toJSON() },
  }
}

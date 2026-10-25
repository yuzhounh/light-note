import { getHTMLFromFragment, getText, getTextSerializersFromSchema } from '@tiptap/core'

/**
 * Each update captures the editor's immutable document; consumers produce and cache each field on first read.
 * Word counts and previews may read text immediately; HTML/JSON can wait for autosave.
 * Output matches editor.getHTML()/getText()/getJSON().
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

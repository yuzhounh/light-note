/** Copies a note without reading its lazy body fields, then applies plain changes. */
export function patchNote(note, changes = {}) {
  const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(note))
  for (const [key, value] of Object.entries(changes)) {
    Object.defineProperty(copy, key, { value, writable: true, enumerable: true, configurable: true })
  }
  return copy
}

/**
 * Body fields are produced from the editor snapshot on first read, so typing costs no full serialization;
 * the snapshot rides along non-enumerable for the editor. A plain spread reads the fields into strings.
 */
export function withEditorContent(note, snapshot) {
  let bodyJson
  return Object.defineProperties(patchNote(note), {
    body_html: { get: () => snapshot.html, enumerable: true, configurable: true },
    body_text: { get: () => snapshot.text, enumerable: true, configurable: true },
    body_json: { get: () => (bodyJson ??= JSON.stringify(snapshot.json)), enumerable: true, configurable: true },
    content_snapshot: { value: snapshot, enumerable: false, configurable: true },
  })
}

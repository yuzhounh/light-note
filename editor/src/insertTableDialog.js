import './insertTableDialog.css'

export function openInsertTableDialog(editor, registerDismiss, anchor) {
  if (!editor?.isEditable || document.querySelector('.insert-table-dialog')) return
  const originalDoc = editor.state.doc
  const selection = editor.state.selection
  const dialog = document.createElement('dialog')
  dialog.className = 'insert-table-dialog'
  dialog.setAttribute('aria-label', '新建表格')
  dialog.innerHTML = `
    <form>
      <h2>新建表格</h2>
      <div class="insert-table-fields">
        <label>行数<input name="rows" type="number" min="1" max="100" step="1" value="3" required autofocus><span>最大 100</span></label>
        <label>列数<input name="cols" type="number" min="1" max="30" step="1" value="3" required><span>最大 30</span></label>
      </div>
      <div class="insert-table-actions">
        <button type="button">取消</button>
        <button type="submit">插入</button>
      </div>
    </form>`
  const form = dialog.querySelector('form')
  let unregisterDismiss
  const finish = (dimensions) => {
    unregisterDismiss?.()
    document.removeEventListener('pointerdown', onOutsidePointer)
    dialog.close()
    dialog.remove()
    if (editor.isDestroyed || !editor.isEditable || editor.state.doc !== originalDoc) return
    const chain = editor.chain().focus().setTextSelection({ from: selection.from, to: selection.to })
    if (dimensions) chain.insertTable({ ...dimensions, withHeaderRow: true })
    chain.run()
  }
  const onOutsidePointer = (event) => {
    if (!dialog.contains(event.target)) finish()
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!form.reportValidity()) return
    finish({ rows: form.elements.rows.valueAsNumber, cols: form.elements.cols.valueAsNumber })
  })
  dialog.querySelector('button[type="button"]').addEventListener('click', () => finish())
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    finish()
  })
  document.body.appendChild(dialog)
  dialog.show()
  const rect = anchor?.getBoundingClientRect()
  dialog.style.left = `${Math.max(8, Math.min(rect?.left ?? 8, window.innerWidth - dialog.offsetWidth - 8))}px`
  dialog.style.top = `${(rect?.bottom ?? 0) + 4}px`
  document.addEventListener('pointerdown', onOutsidePointer)
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); finish() }
  })
  form.elements.rows.select()
  unregisterDismiss = registerDismiss?.(() => finish())
}

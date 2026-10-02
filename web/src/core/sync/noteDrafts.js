// Protect editor changes before the debounced IndexedDB write finishes.
export class DraftAutosave {
  entries = new Map()
  saving = new Map()
  listeners = new Set()
  generation = 0

  get(id) { return this.entries.get(id)?.note }
  has(id) { return this.entries.has(id) }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  notify() {
    const status = [...this.entries.values()].some(entry => entry.error)
      ? 'error' : (this.entries.size || this.saving.size) ? 'saving' : 'saved'
    for (const listener of this.listeners) listener(status)
  }

  schedule(note, save) {
    this.discard(note.id)
    const entry = { note, save }
    this.entries.set(note.id, entry)
    entry.timer = setTimeout(() => {
      this.flush(note.id).catch(error => console.warn('Auto-save failed:', error))
    }, 500)
    this.notify()
  }

  async flush(id) {
    const entry = this.entries.get(id)
    if (!entry) return
    clearTimeout(entry.timer)
    const previous = this.saving.get(id)
    if (previous) {
      await previous.catch(() => {})
      return this.flush(id)
    }
    const job = Promise.resolve().then(() => entry.save(entry.note))
    this.saving.set(id, job)
    try {
      await job
      if (this.entries.get(id) === entry) {
        this.entries.delete(id)
        this.generation++
      }
    } catch (error) {
      entry.error = error
      throw error
    } finally {
      this.saving.delete(id)
      this.notify()
    }
  }

  async flushAll() {
    await Promise.all([...this.entries.keys()].map(id => this.flush(id)))
  }

  discard(id) {
    this.generation++
    clearTimeout(this.entries.get(id)?.timer)
    this.entries.delete(id)
  }
}

export const noteDrafts = new DraftAutosave()

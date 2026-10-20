const sameQuery = (a, b) => a.currentNotebookId === b.currentNotebookId &&
  a.currentView === b.currentView && a.searchQuery === b.searchQuery &&
  a.noteSort.by === b.noteSort.by && a.noteSort.descending === b.noteSort.descending

export function createNoteListLoader({ repository, drafts, getView, setNotes, setActiveNote }) {
  let request = 0
  let lastNotebook = Symbol('initial')
  let lastView
  return async function loadNotes() {
    const current = ++request
    const view = getView()
    const generation = drafts.generation
    const list = await repository.getNotes({
      notebookId: view.currentNotebookId, view: view.currentView, searchQuery: view.searchQuery,
      sortBy: view.noteSort.by, descending: view.noteSort.descending,
    })
    const isCurrent = () => current === request && sameQuery(view, getView())
    if (!isCurrent()) return
    if (generation !== drafts.generation) return loadNotes()
    const changedScope = lastNotebook !== view.currentNotebookId || lastView !== view.currentView
    lastNotebook = view.currentNotebookId
    lastView = view.currentView
    setNotes(prev => isCurrent() && generation === drafts.generation
      ? list.map(note => drafts.get(note.id) || note) : prev)
    setActiveNote(prev => {
      if (!isCurrent() || generation !== drafts.generation) return prev
      const existing = !changedScope && list.find(note => note.id === prev?.id)
      const selected = existing || (!getView().isMobile ? list[0] : null)
      return selected ? drafts.get(selected.id) || selected : null
    })
  }
}

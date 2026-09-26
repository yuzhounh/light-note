import React, { useState, useEffect, useRef } from 'react'
import { Plus } from 'lucide-react'
import { seedInitialData } from './core/db/database'
import { NotesRepository } from './core/db/notesRepository'
import { useResponsive } from './hooks/useResponsive'
import { useBackButton } from './hooks/useBackButton'
import { Sidebar } from './components/layout/Sidebar'
import { NoteList } from './components/layout/NoteList'
import { NoteDetail } from './components/layout/NoteDetail'
import { SettingsModal } from './components/modals/SettingsModal'
import { AuthModal } from './components/modals/AuthModal'

export function App() {
  const { isMobile, isTablet, isDesktop } = useResponsive()
  
  // App state
  const [notebooks, setNotebooks] = useState([])
  const [notes, setNotes] = useState([])
  const [activeNote, setActiveNote] = useState(null)
  const [currentNotebookId, setCurrentNotebookId] = useState(null)
  const [currentView, setCurrentView] = useState('all') // 'all' | 'pinned' | 'trash'
  const [searchQuery, setSearchQuery] = useState('')
  const [saveStatus, setSaveStatus] = useState('saved')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  
  // Theme state
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('lightnote_theme') || 
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  })

  // Mobile navigation state
  const [mobileView, setMobileView] = useState('list') // 'list' | 'detail'
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  // Hardware/gesture back button handling
  useBackButton({
    isMobile,
    isSidebarOpen,
    onCloseSidebar: () => setIsSidebarOpen(false),
    mobileView,
    onBackToList: () => setMobileView('list'),
  })

  // Debounced auto-save timer ref
  const saveTimeoutRef = useRef(null)

  // Initialize theme class on document element
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    localStorage.setItem('lightnote_theme', theme)
  }, [theme])

  // Initialize database and load notebooks/notes
  useEffect(() => {
    async function init() {
      await seedInitialData()
      await refreshData()
    }
    init()
  }, [])

  // Reload notes when view, notebook, or search query changes
  useEffect(() => {
    loadNotes()
  }, [currentNotebookId, currentView, searchQuery])

  async function refreshData() {
    const nbs = await NotesRepository.getAllNotebooks()
    setNotebooks(nbs)
    await loadNotes()
  }

  async function loadNotes() {
    const list = await NotesRepository.getNotes({
      notebookId: currentNotebookId,
      view: currentView,
      searchQuery,
    })
    setNotes(list)
    
    // Auto-select first note if desktop and no note active
    if (!isMobile && list.length > 0 && !activeNote) {
      setActiveNote(list[0])
    }
  }

  // Handle Note Selection
  function handleSelectNote(id) {
    const found = notes.find(n => n.id === id)
    if (found) {
      setActiveNote(found)
      if (isMobile) {
        setMobileView('detail')
      }
    }
  }

  // Create New Note
  async function handleCreateNote() {
    const targetNotebookId = currentNotebookId || (notebooks[0] ? notebooks[0].id : null)
    const newNote = await NotesRepository.createNote({
      notebookId: targetNotebookId,
      title: '',
      bodyHtml: '',
      bodyText: '',
    })

    setNotes(prev => [newNote, ...prev])
    setActiveNote(newNote)
    if (isMobile) {
      setMobileView('detail')
    }
  }

  // Update Note Title
  function handleUpdateTitle(newTitle) {
    if (!activeNote) return
    const updated = { ...activeNote, title: newTitle }
    setActiveNote(updated)
    setNotes(prev => prev.map(n => n.id === updated.id ? updated : n))
    triggerAutoSave(updated)
  }

  // Update Note Body Content
  function handleUpdateContent({ html, text }) {
    if (!activeNote) return
    const updated = { ...activeNote, body_html: html, body_text: text }
    setActiveNote(updated)
    setNotes(prev => prev.map(n => n.id === updated.id ? updated : n))
    triggerAutoSave(updated)
  }

  // 500ms Debounced Auto-Save
  function triggerAutoSave(noteToSave) {
    setSaveStatus('saving')
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(async () => {
      await NotesRepository.saveNote(noteToSave.id, {
        title: noteToSave.title,
        bodyHtml: noteToSave.body_html,
        bodyText: noteToSave.body_text,
      })
      setSaveStatus('saved')
    }, 500)
  }

  // Toggle Note Pin
  async function handleTogglePin(id) {
    await NotesRepository.togglePin(id)
    await loadNotes()
    if (activeNote && activeNote.id === id) {
      setActiveNote(prev => ({ ...prev, is_pinned: prev.is_pinned === 1 ? 0 : 1 }))
    }
  }

  // Soft Delete Note (Move to Trash)
  async function handleSoftDelete(id) {
    await NotesRepository.softDeleteNote(id)
    await loadNotes()
    if (activeNote && activeNote.id === id) {
      setActiveNote(null)
      if (isMobile) setMobileView('list')
    }
  }

  // Restore Note
  async function handleRestoreNote(id) {
    await NotesRepository.restoreNote(id)
    await loadNotes()
  }

  // Permanent Delete Note
  async function handlePermanentDelete(id) {
    await NotesRepository.permanentDeleteNote(id)
    await loadNotes()
    if (activeNote && activeNote.id === id) {
      setActiveNote(null)
    }
  }

  // Create Notebook
  async function handleCreateNotebook(name) {
    const nb = await NotesRepository.createNotebook(name)
    setNotebooks(prev => [...prev, nb])
    setCurrentNotebookId(nb.id)
    setCurrentView('all')
  }

  // Delete Notebook
  async function handleDeleteNotebook(id) {
    await NotesRepository.deleteNotebook(id)
    const remaining = notebooks.filter(n => n.id !== id)
    setNotebooks(remaining)
    if (currentNotebookId === id) {
      setCurrentNotebookId(null)
    }
    await loadNotes()
  }

  // Global Keyboard Shortcuts
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault()
        handleCreateNote()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (activeNote && saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current)
          NotesRepository.saveNote(activeNote.id, {
            title: activeNote.title,
            bodyHtml: activeNote.body_html,
            bodyText: activeNote.body_text,
          }).then(() => setSaveStatus('saved'))
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeNote, notebooks, currentNotebookId])

  const currentNotebookName = notebooks.find(n => n.id === currentNotebookId)?.name

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans">
      {/* Main Multi-Column or Mobile Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* --- DESKTOP / TABLET (3-column / 2-column) --- */}
        {!isMobile && (
          <>
            {/* Column 1: Sidebar (200px) */}
            <div className="w-52 shrink-0 h-full">
              <Sidebar
                notebooks={notebooks}
                currentNotebookId={currentNotebookId}
                currentView={currentView}
                onSelectNotebook={id => { setCurrentNotebookId(id); setCurrentView('all') }}
                onSelectView={view => { setCurrentView(view); setCurrentNotebookId(null) }}
                onCreateNotebook={handleCreateNotebook}
                onDeleteNotebook={handleDeleteNotebook}
                onCreateNote={handleCreateNote}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onOpenAuth={() => setIsAuthOpen(true)}
                theme={theme}
                onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
                isMobile={false}
              />
            </div>

            {/* Column 2: Note List (280px) */}
            <div className="w-72 shrink-0 h-full">
              <NoteList
                notes={notes}
                activeNoteId={activeNote?.id}
                onSelectNote={handleSelectNote}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                currentNotebookName={currentNotebookName}
                onTogglePin={handleTogglePin}
                onSoftDelete={handleSoftDelete}
                isMobile={false}
              />
            </div>

            {/* Column 3: Note Detail & Editor (Flexible) */}
            <div className="flex-1 h-full overflow-hidden">
              <NoteDetail
                note={activeNote}
                onUpdateTitle={handleUpdateTitle}
                onUpdateContent={handleUpdateContent}
                isMobile={false}
              />
            </div>
          </>
        )}

        {/* --- MOBILE VIEW (< 768px, Navigation Stack & Drawer) --- */}
        {isMobile && (
          <div className="relative w-full h-full flex flex-col overflow-hidden">
            {/* Drawer Sidebar Overlay */}
            {isSidebarOpen && (
              <div className="fixed inset-0 z-50 flex">
                <div 
                  className="fixed inset-0 bg-black/50 backdrop-blur-sm"
                  onClick={() => setIsSidebarOpen(false)}
                />
                <div className="relative z-10 w-72 h-full shadow-2xl animate-in slide-in-from-left duration-200">
                  <Sidebar
                    notebooks={notebooks}
                    currentNotebookId={currentNotebookId}
                    currentView={currentView}
                    onSelectNotebook={id => { setCurrentNotebookId(id); setCurrentView('all'); setIsSidebarOpen(false) }}
                    onSelectView={view => { setCurrentView(view); setCurrentNotebookId(null); setIsSidebarOpen(false) }}
                    onCreateNotebook={handleCreateNotebook}
                    onDeleteNotebook={handleDeleteNotebook}
                    onCreateNote={handleCreateNote}
                    onOpenSettings={() => setIsSettingsOpen(true)}
                    onOpenAuth={() => setIsAuthOpen(true)}
                    theme={theme}
                    onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
                    onCloseMobile={() => setIsSidebarOpen(false)}
                    isMobile={true}
                  />
                </div>
              </div>
            )}

            {/* Mobile Screen: List View */}
            {mobileView === 'list' && (
              <div className="relative w-full h-full flex flex-col">
                <NoteList
                  notes={notes}
                  activeNoteId={activeNote?.id}
                  onSelectNote={handleSelectNote}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  currentNotebookName={currentNotebookName}
                  onOpenSidebar={() => setIsSidebarOpen(true)}
                  onTogglePin={handleTogglePin}
                  onSoftDelete={handleSoftDelete}
                  isMobile={true}
                />

                {/* Floating Action Button (FAB) for mobile new note */}
                {currentView !== 'trash' && (
                  <button
                    onClick={handleCreateNote}
                    className="fixed right-5 bottom-6 w-14 h-14 rounded-full bg-emerald-500 text-white shadow-lg flex items-center justify-center active:scale-95 transition z-40 cursor-pointer"
                    title="新建笔记"
                  >
                    <Plus size={28} />
                  </button>
                )}
              </div>
            )}

            {/* Mobile Screen: Detail View */}
            {mobileView === 'detail' && (
              <div className="w-full h-full flex flex-col">
                <NoteDetail
                  note={activeNote}
                  onUpdateTitle={handleUpdateTitle}
                  onUpdateContent={handleUpdateContent}
                  onBackMobile={() => setMobileView('list')}
                  isMobile={true}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        theme={theme}
        onChangeTheme={setTheme}
        onDataImported={refreshData}
      />

      {/* Google / Account Auth Modal */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
      />
    </div>
  )
}

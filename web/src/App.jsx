import React, { useState, useEffect, useRef } from 'react'
import { NotesRepository } from './core/db/notesRepository'
import { seedInitialData } from './core/db/database'
import { syncService, subscribeSyncState, getSyncState } from './core/sync/syncService'
import { noteDrafts } from './core/sync/noteDrafts'
import { useResponsive } from './hooks/useResponsive'
import { useBackButton } from './hooks/useBackButton'
import { Sidebar } from './components/layout/Sidebar'
import { NoteList } from './components/layout/NoteList'
import { NoteDetail } from './components/layout/NoteDetail'
import { SettingsModal } from './components/modals/SettingsModal'
import { loginWithGoogle, logoutFirebase, subscribeAuth } from './core/auth/firebaseAuth'
import { Plus } from 'lucide-react'

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
  const [currentUser, setCurrentUser] = useState(null)
  const [syncStatus, setSyncStatus] = useState(() => syncService.getSyncState())
  const [shouldFocusEditor, setShouldFocusEditor] = useState(false)
  
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

  const prevIsMobileRef = useRef(isMobile)
  useEffect(() => {
    if (!prevIsMobileRef.current && isMobile && activeNote) {
      setMobileView('detail')
    }
    prevIsMobileRef.current = isMobile
  }, [isMobile, activeNote])

  const viewRef = useRef(null)
  viewRef.current = { currentNotebookId, currentView, searchQuery, isMobile }

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

    // Subscribe to Firebase Google Auth state
    const unsubscribeAuth = subscribeAuth(user => {
      setCurrentUser(user)
      syncService.setUser(user, () => refreshData())
    })

    const unsubscribeSync = subscribeSyncState(status => {
      setSyncStatus(status)
    })
    const unsubscribeDrafts = noteDrafts.subscribe(setSaveStatus)

    return () => {
      unsubscribeAuth()
      unsubscribeSync()
      unsubscribeDrafts()
      noteDrafts.flushAll().catch(err => console.warn('Final save failed:', err))
      syncService.stopRealtimeSync()
    }
  }, [])

  // Direct Google Login (via native Credential Manager on Android, popup on Web)
  async function handleGoogleLogin() {
    try {
      const user = await loginWithGoogle()
      setCurrentUser(user)
      syncService.setUser(user, () => refreshData())
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'SIGN_IN_CANCELLED') {
        const friendlyMessages = {
          'auth/popup-blocked': '浏览器阻止了登录窗口，请允许本站弹出窗口后重试。',
          'auth/popup-closed-by-user': '登录窗口已关闭，请重新尝试。',
          'auth/unauthorized-domain': '当前网站域名尚未加入 Firebase 授权域名。',
          'auth/network-request-failed': '网络连接失败，请检查网络后重试。',
          'SIGN_IN_CANCELLED': '已取消 Google 登录。',
          'NATIVE_SIGN_IN_FAILED': '手机系统未能完成 Google 登录，请检查 Google Play 服务和网络后重试。'
        }
        alert(friendlyMessages[err.code] || err.message || ('Google 登录异常: ' + (err.code || err)))
      }
    }
  }

  // Logout
  async function handleLogout() {
    await logoutFirebase()
    setCurrentUser(null)
    syncService.setUser(null)
  }

  // Manual trigger sync
  async function handleManualSync() {
    try {
      await noteDrafts.flushAll()
      if (!currentUser) {
        await handleGoogleLogin()
        return
      }
      await syncService.syncNow(currentUser, () => refreshData())
      await refreshData()
    } catch (err) {
      console.warn('Manual sync failed:', err)
    }
  }

  // Reload notes when view, notebook, or search query changes
  useEffect(() => {
    loadNotes()
  }, [currentNotebookId, currentView, searchQuery])

  async function refreshData() {
    const draftGeneration = noteDrafts.generation
    const view = viewRef.current
    const nbs = await NotesRepository.getAllNotebooks()
    setNotebooks(nbs)
    const list = await NotesRepository.getNotes({
      notebookId: view.currentNotebookId,
      view: view.currentView,
      searchQuery: view.searchQuery,
    })
    if (draftGeneration !== noteDrafts.generation) return refreshData()
    setNotes(prev => draftGeneration === noteDrafts.generation
      ? list.map(note => noteDrafts.get(note.id) || note) : prev)
    setActiveNote(prev => {
      if (draftGeneration !== noteDrafts.generation) return prev
      if (!prev) return (!view.isMobile && list.length > 0) ? list[0] : null
      const draft = noteDrafts.get(prev.id)
      if (draft) return draft
      const updated = list.find(n => n.id === prev.id)
      return updated || ((!view.isMobile && list.length > 0) ? list[0] : null)
    })
  }

  async function loadNotes() {
    const draftGeneration = noteDrafts.generation
    const list = await NotesRepository.getNotes({
      notebookId: currentNotebookId,
      view: currentView,
      searchQuery,
    })
    if (draftGeneration !== noteDrafts.generation) return loadNotes()
    setNotes(prev => draftGeneration === noteDrafts.generation
      ? list.map(note => noteDrafts.get(note.id) || note) : prev)
    
    // Auto-select first note if desktop and no note active
    if (!isMobile && list.length > 0 && !activeNote) {
      setActiveNote(prev => prev || noteDrafts.get(list[0].id) || list[0])
    }
  }

  // Handle Note Selection
  function handleSelectNote(id) {
    const found = notes.find(n => n.id === id)
    if (found) {
      setActiveNote(noteDrafts.get(id) || found)
      setMobileView('detail')
    }
  }

  // Create New Note
  async function handleCreateNote() {
    const targetNotebookId = currentNotebookId || (notebooks[0] ? notebooks[0].id : null)
    const newNote = await NotesRepository.createNote({
      notebookId: targetNotebookId,
      title: '',
      bodyHtml: '<p></p>',
      bodyText: '',
    })

    setNotes(prev => [newNote, ...prev])
    setActiveNote(newNote)
    setShouldFocusEditor(true)
    setMobileView('detail')
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
  function handleUpdateContent({ html, text, json }) {
    if (!activeNote) return
    const updated = { ...activeNote, body_html: html, body_text: text, body_json: JSON.stringify(json) }
    setActiveNote(updated)
    setNotes(prev => prev.map(n => n.id === updated.id ? updated : n))
    triggerAutoSave(updated)
  }

  // 500ms Debounced Auto-Save
  function triggerAutoSave(noteToSave) {
    noteDrafts.schedule(noteToSave, note => NotesRepository.saveNote(note.id, {
      title: note.title, bodyHtml: note.body_html, bodyText: note.body_text, bodyJson: note.body_json,
    }))
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
    await noteDrafts.flush(id)
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
        noteDrafts.flushAll().catch(err => console.warn('Save failed:', err))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeNote, notebooks, currentNotebookId])

  const currentNotebookName = notebooks.find(n => n.id === currentNotebookId)?.name

  return (
    <div className="lightnote-app flex h-full w-full overflow-hidden bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans">
      {/* Main Multi-Column or Mobile Layout */}
      <div className="flex-1 min-w-0 min-h-0 flex overflow-hidden">
        {/* --- DESKTOP / TABLET (3-column / 2-column) --- */}
        {!isMobile && (
          <>
            {/* Column 1: Sidebar (200px) */}
            <div className={`${isDesktop ? 'block' : 'hidden'} w-52 shrink-0 h-full`}>
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
                currentUser={currentUser}
                onLoginGoogle={handleGoogleLogin}
                onLogout={handleLogout}
                theme={theme}
                onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
                isMobile={false}
                syncStatus={syncStatus}
                onSync={handleManualSync}
              />
            </div>

            {/* Column 2: Note List (320px) */}
            <div className={`${isTablet ? 'w-72' : 'w-80'} shrink-0 h-full`}>
              <NoteList
                notes={notes}
                activeNoteId={activeNote?.id}
                onSelectNote={handleSelectNote}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                currentNotebookName={currentNotebookName}
                notebooks={notebooks}
                currentNotebookId={currentNotebookId}
                onTogglePin={handleTogglePin}
                onSoftDelete={handleSoftDelete}
                onOpenSidebar={() => setIsSidebarOpen(true)}
                isMobile={isTablet}
              />
            </div>

            {/* Column 3: Note Detail & Editor (Flexible) */}
            <div className="flex-1 min-w-0 h-full overflow-hidden">
              <NoteDetail
                note={activeNote}
                onUpdateTitle={handleUpdateTitle}
                onUpdateContent={handleUpdateContent}
                isMobile={false}
                autoFocus={shouldFocusEditor}
                onFocused={() => setShouldFocusEditor(false)}
              />
            </div>
          </>
        )}

        {/* Phone navigation stack; shared phone/tablet drawer */}
        {(isMobile || isTablet) && (
          <div className={isMobile ? 'relative w-full h-full flex flex-col overflow-hidden' : 'contents'}>
            {/* Drawer Sidebar Overlay */}
            {isSidebarOpen && (
              <div className="fixed inset-0 z-50 flex">
                <div 
                  className="fixed inset-0 bg-black/50 backdrop-blur-sm"
                  onClick={() => setIsSidebarOpen(false)}
                />
                <div className="mobile-sidebar relative z-10 h-full shadow-2xl" role="dialog" aria-modal="true" aria-label="笔记导航">
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
                    currentUser={currentUser}
                    onLoginGoogle={handleGoogleLogin}
                    onLogout={handleLogout}
                    theme={theme}
                    onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
                    onCloseMobile={() => setIsSidebarOpen(false)}
                    isMobile={true}
                    syncStatus={syncStatus}
                    onSync={handleManualSync}
                  />
                </div>
              </div>
            )}

            {/* Mobile Screen: List View */}
            {isMobile && mobileView === 'list' && (
              <div className="relative w-full h-full flex flex-col">
                <NoteList
                  notes={notes}
                  activeNoteId={activeNote?.id}
                  onSelectNote={handleSelectNote}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  currentNotebookName={currentNotebookName}
                  notebooks={notebooks}
                  currentNotebookId={currentNotebookId}
                  onOpenSidebar={() => setIsSidebarOpen(true)}
                  onTogglePin={handleTogglePin}
                  onSoftDelete={handleSoftDelete}
                  isMobile={true}
                />

                {/* Floating Action Button (FAB) for mobile new note */}
                {currentView !== 'trash' && (
                  <button
                    onClick={handleCreateNote}
                    className="mobile-new-note fixed right-5 bottom-6 w-11 h-11 rounded-full bg-[#00b87a] text-white shadow-md hover:shadow-lg flex items-center justify-center active:scale-90 transition z-40 cursor-pointer"
                    title="新建笔记"
                  >
                    <Plus size={22} strokeWidth={2.5} />
                  </button>
                )}
              </div>
            )}

            {/* Mobile Screen: Detail View */}
            {isMobile && mobileView === 'detail' && (
              <div className="w-full h-full flex flex-col">
                <NoteDetail
                  note={activeNote}
                  onUpdateTitle={handleUpdateTitle}
                  onUpdateContent={handleUpdateContent}
                  onBackMobile={() => setMobileView('list')}
                  isMobile={true}
                  autoFocus={shouldFocusEditor}
                  onFocused={() => setShouldFocusEditor(false)}
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
    </div>
  )
}

import { useEffect } from 'react'
import { App as CapApp } from '@capacitor/app'

/**
 * Handle Android hardware/gesture back button and browser history popstate
 */
export function useBackButton({
  isMobile,
  isSidebarOpen,
  onCloseSidebar,
  mobileView,
  onBackToList,
}) {
  useEffect(() => {
    let removeListener = null

    // Register Capacitor native back button listener
    try {
      CapApp.addListener('backButton', ({ canGoBack }) => {
        if (isSidebarOpen) {
          onCloseSidebar()
          return
        }
        if (mobileView === 'detail') {
          onBackToList()
          return
        }
        // If on list view, exit app if cannot go back
        CapApp.exitApp()
      }).then(handle => {
        removeListener = () => handle.remove()
      }).catch(() => {})
    } catch (e) {
      // Not running in Capacitor, fallback to browser popstate
    }

    return () => {
      if (removeListener) removeListener()
    }
  }, [isMobile, isSidebarOpen, mobileView, onCloseSidebar, onBackToList])
}

import { useEffect, useRef } from 'react'
import { App as CapApp } from '@capacitor/app'
import { dismissTopPopup } from './useBackDismiss'

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
  const navigationRef = useRef(null)
  navigationRef.current = { isSidebarOpen, onCloseSidebar, mobileView, onBackToList }
  useEffect(() => {
    let removeListener = null
    let disposed = false

    // Register Capacitor native back button listener
    try {
      CapApp.addListener('backButton', () => {
        if (disposed) return
        if (dismissTopPopup()) return
        const navigation = navigationRef.current
        if (navigation.isSidebarOpen) {
          navigation.onCloseSidebar()
          return
        }
        if (navigation.mobileView === 'detail') {
          navigation.onBackToList()
          return
        }
        // If on list view, exit app if cannot go back
        CapApp.exitApp()
      }).then(handle => {
        if (disposed) return handle.remove()
        else removeListener = () => handle.remove()
      }).catch(() => {})
    } catch (e) {
      // Not running in Capacitor, fallback to browser popstate
    }

    return () => {
      disposed = true
      if (removeListener) removeListener()
    }
  }, [])
}

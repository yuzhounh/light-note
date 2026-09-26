import { useState, useEffect } from 'react'

export function useResponsive() {
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1200
  )

  useEffect(() => {
    function handleResize() {
      setWindowWidth(window.innerWidth)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return {
    windowWidth,
    isMobile: windowWidth < 768,
    isTablet: windowWidth >= 768 && windowWidth < 1024,
    isDesktop: windowWidth >= 1024,
  }
}

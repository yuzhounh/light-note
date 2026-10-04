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
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  return {
    windowWidth,
    isMobile: windowWidth < 744,
    isTablet: windowWidth >= 744 && windowWidth < 1024,
    isDesktop: windowWidth >= 1024,
  }
}

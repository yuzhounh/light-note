import { useState, useEffect } from 'react'

const SMALL_TOUCH_TABLET = '(min-width: 744px) and (max-width: 1023px) and (min-height: 600px) and (pointer: coarse)'

export function useResponsive() {
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1200
  )
  const [isTouchTablet, setIsTouchTablet] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(SMALL_TOUCH_TABLET).matches
  )

  useEffect(() => {
    const tabletMedia = window.matchMedia(SMALL_TOUCH_TABLET)
    function handleResize() {
      setWindowWidth(window.innerWidth)
      setIsTouchTablet(tabletMedia.matches)
    }

    window.addEventListener('resize', handleResize)
    tabletMedia.addEventListener('change', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      tabletMedia.removeEventListener('change', handleResize)
    }
  }, [])

  return {
    windowWidth,
    isMobile: windowWidth < 768 && !isTouchTablet,
    isTablet: isTouchTablet || (windowWidth >= 768 && windowWidth < 1024),
    isDesktop: windowWidth >= 1024,
  }
}

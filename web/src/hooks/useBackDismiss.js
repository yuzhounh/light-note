import { useLayoutEffect, useRef } from 'react'

const popups = []
let sequence = 0

export function registerBackDismiss(close, layer = 50) {
  const popup = { close, layer, order: ++sequence }
  popups.push(popup)
  return () => {
    const index = popups.indexOf(popup)
    if (index !== -1) popups.splice(index, 1)
  }
}

export function dismissTopPopup() {
  const top = popups.reduce((best, popup) => !best || popup.layer > best.layer ||
    (popup.layer === best.layer && popup.order > best.order) ? popup : best, null)
  if (!top) return false
  popups.splice(popups.indexOf(top), 1)
  top.close()
  return true
}

export function useBackDismiss(active, onClose, layer = 50) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useLayoutEffect(() => {
    if (active) return registerBackDismiss(() => closeRef.current(), layer)
  }, [active, layer])
}

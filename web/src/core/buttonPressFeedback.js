const PRESS_TARGET = 'button:enabled, [role="button"]:not([aria-disabled="true"]), .notebook-row, .sidebar-group-header'

// Keep the visual acknowledgment briefly after release without delaying clicks.
export function installButtonPressFeedback(documentRoot) {
  let pressedElement = null
  let pointerId = null
  let releaseTimer = null

  function reset() {
    clearTimeout(releaseTimer)
    pressedElement?.removeAttribute('data-touch-pressed')
    pressedElement = null
    pointerId = null
    releaseTimer = null
  }

  function handlePointerDown(event) {
    if (event.button !== 0) return
    reset()
    const target = event.target?.closest?.(PRESS_TARGET)
    if (!target || target.closest('[inert], [aria-disabled="true"]')) return
    pressedElement = target
    pointerId = event.pointerId
    target.setAttribute('data-touch-pressed', '')
  }

  function handlePointerUp(event) {
    if (event.pointerId !== pointerId) return
    releaseTimer = setTimeout(reset, 150)
  }

  function handlePointerCancel(event) {
    if (event.pointerId === pointerId) reset()
  }

  documentRoot.addEventListener('pointerdown', handlePointerDown, true)
  documentRoot.addEventListener('pointerup', handlePointerUp, true)
  documentRoot.addEventListener('pointercancel', handlePointerCancel, true)
  documentRoot.defaultView?.addEventListener('blur', reset)

  return () => {
    reset()
    documentRoot.removeEventListener('pointerdown', handlePointerDown, true)
    documentRoot.removeEventListener('pointerup', handlePointerUp, true)
    documentRoot.removeEventListener('pointercancel', handlePointerCancel, true)
    documentRoot.defaultView?.removeEventListener('blur', reset)
  }
}

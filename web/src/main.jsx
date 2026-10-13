import React from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { Capacitor } from '@capacitor/core'
import { App } from './App'
import { installButtonPressFeedback } from './core/buttonPressFeedback'
import './index.css'

if (Capacitor.getPlatform() === 'android') {
  document.documentElement.classList.add('lightnote-android')
  installButtonPressFeedback(document)
}

// APK assets come from the installed package. Keep PWA caching for browsers.
if (Capacitor.getPlatform() !== 'android') {
  registerSW({ immediate: true })
} else if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.getRegistrations().then(async registrations => {
    await Promise.all(registrations.map(registration => registration.unregister()))
    if (hadController) location.reload()
  }).catch(console.warn)
}

const rootElement = document.getElementById('root')
if (rootElement) {
  createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

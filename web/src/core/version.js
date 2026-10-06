// Unified version definition synchronized across Desktop, Web, PWA, and Mobile.
// The value comes from web/package.json at build time (injected by vite.config.js),
// so bumping package.json is enough; no second place to update.
export const APP_NAME = 'LightNote'
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
export const APP_DISPLAY_VERSION = `${APP_NAME} v${APP_VERSION}`

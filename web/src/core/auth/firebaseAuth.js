import { initializeApp, getApps, getApp } from 'firebase/app'
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut 
} from 'firebase/auth'

export const DEFAULT_FIREBASE_CONFIG = {
  projectId: "lightnote-sync",
  apiKey: "AIzaSyBe_QReM-ybgbtTHAABYMtsEc__RZX9ROk",
  authDomain: "lightnote-sync.firebaseapp.com",
  storageBucket: "lightnote-sync.firebasestorage.app"
}

export function getFirebaseConfig() {
  const local = localStorage.getItem('lightnote_firebase_config')
  if (local) {
    try {
      const parsed = JSON.parse(local)
      if (parsed && parsed.projectId) return parsed
    } catch (_) {}
  }
  return DEFAULT_FIREBASE_CONFIG
}

export function initFirebase() {
  const config = getFirebaseConfig()
  if (!getApps().length) {
    return initializeApp(config)
  }
  return getApp()
}

/**
 * Directly trigger Google Sign-In with official popup
 */
export async function loginWithGoogle() {
  const app = initFirebase()
  const auth = getAuth(app)
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  
  const result = await signInWithPopup(auth, provider)
  return result.user
}

/**
 * Sign out current user
 */
export async function logoutFirebase() {
  const app = initFirebase()
  const auth = getAuth(app)
  await signOut(auth)
}

/**
 * Listen for auth state changes
 */
export function subscribeAuth(callback) {
  try {
    const app = initFirebase()
    const auth = getAuth(app)
    return onAuthStateChanged(auth, callback)
  } catch (err) {
    console.error('Firebase Auth subscription failed:', err)
    return () => {}
  }
}

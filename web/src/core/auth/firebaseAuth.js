import { initializeApp, getApps, getApp } from 'firebase/app'
import { 
  getAuth, 
  signInWithPopup, 
  signInWithCredential,
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut 
} from 'firebase/auth'
import { Capacitor, registerPlugin } from '@capacitor/core'

export const DEFAULT_FIREBASE_CONFIG = {
  projectId: "lightnote-sync",
  apiKey: "AIzaSyBe_QReM-ybgbtTHAABYMtsEc__RZX9ROk",
  authDomain: "lightnote-sync.firebaseapp.com",
  storageBucket: "lightnote-sync.firebasestorage.app",
  googleClientId: "589160261764-c2t7mqui1ve0gk9tnd96om0ho87u2iik.apps.googleusercontent.com"
}

const nativeGoogleAuth = registerPlugin('NativeGoogleAuth')

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
 * Trigger Google Sign-In (Native on Android, Popup on Web)
 */
export async function loginWithGoogle() {
  const app = initFirebase()
  const auth = getAuth(app)
  const config = getFirebaseConfig()

  if (Capacitor.isNativePlatform()) {
    const { idToken } = await nativeGoogleAuth.signIn({
      webClientId: config.googleClientId || DEFAULT_FIREBASE_CONFIG.googleClientId
    })
    const credential = GoogleAuthProvider.credential(idToken)
    const result = await signInWithCredential(auth, credential)
    return result.user
  }

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
  if (Capacitor.isNativePlatform()) {
    await nativeGoogleAuth.clearCredentialState().catch(error => {
      console.warn('Failed to clear native Google credential state:', error)
    })
  }
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

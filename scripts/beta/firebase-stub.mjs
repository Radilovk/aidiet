/** Подмяна на Firebase (app + auth) за бета-теста: тестов потребител, токенът е подписан от локалния стек. */
export const FIREBASE_APP = `
const apps = [];
export function initializeApp(options, name) { const a = { name: name || '[DEFAULT]', options }; apps.push(a); return a; }
export function getApps() { return apps; }
export function getApp() { return apps[0] || initializeApp({}); }
`;

export const FIREBASE_AUTH = `
const KEY = '__beta_user';
const listeners = new Set();
function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
function makeUser(d) {
  if (!d) return null;
  return { uid: d.uid, email: d.email, displayName: d.name || null, emailVerified: true, isAnonymous: false,
    providerData: [{ providerId: 'password', email: d.email }], metadata: {},
    async getIdToken() { const r = await fetch('/__beta/token?uid=' + encodeURIComponent(d.uid) + '&email=' + encodeURIComponent(d.email)); return r.text(); },
    async reload() {} };
}
const auth = { currentUser: makeUser(load()), languageCode: 'bg', onAuthStateChanged: (cb) => onAuthStateChanged(auth, cb) };
function emit() { listeners.forEach((cb) => { try { cb(auth.currentUser); } catch (e) { console.error(e); } }); }
export function getAuth() { return auth; }
export function onAuthStateChanged(_a, cb) { listeners.add(cb); setTimeout(() => cb(auth.currentUser), 0); return () => listeners.delete(cb); }
function uidOf(email) { return 'beta_' + String(email).toLowerCase().replace(/[^a-z0-9]/g, '_'); }
export async function signInWithEmailAndPassword(_a, email, password) {
  if (!email || !password) { const e = new Error('auth/invalid-credential'); e.code = 'auth/invalid-credential'; throw e; }
  const d = { uid: uidOf(email), email };
  localStorage.setItem(KEY, JSON.stringify(d)); auth.currentUser = makeUser(d); emit();
  return { user: auth.currentUser };
}
export const createUserWithEmailAndPassword = signInWithEmailAndPassword;
export async function signOut() { localStorage.removeItem(KEY); auth.currentUser = null; emit(); }
export async function deleteUser() { return signOut(); }
export async function sendPasswordResetEmail() {}
export async function updateProfile() {}
export async function setPersistence() {}
export const browserLocalPersistence = {}; export const indexedDBLocalPersistence = {};
export class GoogleAuthProvider { addScope() {} setCustomParameters() {} }
export async function signInWithPopup() { const e = new Error('auth/popup-blocked'); e.code = 'auth/popup-blocked'; throw e; }
`;

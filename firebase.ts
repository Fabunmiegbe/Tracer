import { getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const make = (name = '[DEFAULT]') => {
  const app = getApps().find((a) => a.name === name) ?? initializeApp(config, name);
  return { auth: getAuth(app), db: getFirestore(app), fns: getFunctions(app) };
};

export const { auth, db, fns } = make();
// The agent page uses its own app instance so pairing a phone never replaces an owner's login in the same browser.
export const agent = make('agent');
